// 비공개 사건 저장 계획의 검증 순서와 서버 재평가 테스트
import { describe, expect, it, vi } from "vitest";
import type { VerifiedMatch } from "@replay/application";
import { incidentDigest } from "@replay/rule-engine";
import {
    incidentLineage,
    PRIVATE_INDEX_BYTES,
    PRIVATE_INDEX_ROWS,
    type PrivateIncidentBatch,
    type PrivateIncidentRow
} from "@replay/shared-types";
import { boundedBatch, incidentPlan } from "../../src/application/use-cases/incidents/plan";
import {
    declaredMatch,
    lockedMatch,
    planContext,
    privateBatch,
    storedEvidence
} from "../fixtures/private-incident";

describe("incident plan", () => {
    it("plans an observation without a typed record and skips the rule context read", async () => {
        // 유형별 사건 없는 배치 생성
        const batch = await privateBatch(false);
        // 현재 검증 경기 조회 모의객체 생성
        const read = vi.fn(async () => lockedMatch);

        // 관측 행만 담긴 저장 계획 확인
        await expect(incidentPlan(batch, planContext, read)).resolves.toEqual([
            {
                observation: batch.rows[0]!.observation,
                observationSha256: batch.rows[0]!.observationSha256,
                reasons: batch.rows[0]!.reasons,
                record: null
            }
        ]);
        // 검증 경기 선언이 없어 잠금 조회 생략 확인
        expect(read).not.toHaveBeenCalled();
    });

    it("re-evaluates a verified record with the locked match and a server recomputed hash", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 현재 검증 경기 조회 모의객체 생성
        const read = vi.fn(async () => lockedMatch);
        // 저장 계획 생성
        const plan = await incidentPlan(batch, planContext, read);
        // 계획된 유형별 사건 읽음
        const record = plan[0]!.record!;

        // 잠금 조회가 배치당 한 번만 실행됨 확인
        expect(read).toHaveBeenCalledOnce();
        // 사건 내용 해시를 서버가 다시 계산함 확인
        expect(record.recordSha256).toBe(incidentDigest(batch.rows[0]!.record!));
        // 검증된 계보 보존 확인
        expect(record.link).toEqual(batch.rows[0]!.link);
        // 운영 승인 방법이 없어 승인 사실이 없음 확인
        expect(record.factIds).toEqual([]);
        // 승인 사실 없이 반칙 질문이 미정으로 남음 확인
        expect(record.evaluations[0]!.conclusions.offence.status).toBe("UNDETERMINED");
    });

    it("evaluates an unverified record without reading the rule context", async () => {
        // 경기 문맥 없이 만든 잡기 사건 배치 생성
        const batch = await privateBatch(true);
        // 현재 검증 경기 조회 모의객체 생성
        const read = vi.fn(async () => lockedMatch);
        // 저장 계획 생성
        const plan = await incidentPlan(batch, planContext, read);

        // 검증 경기 선언이 없어 잠금 조회 생략 확인
        expect(read).not.toHaveBeenCalled();
        // 규정 판본을 기본값으로 채우지 않아 평가가 없음 확인
        expect(plan[0]!.record!.evaluations).toEqual([]);
    });

    it.each<[string, (batch: PrivateIncidentBatch) => PrivateIncidentBatch]>([
        ["schema", (batch) => ({ ...batch, schemaVersion: "private-incidents-v0" as never })],
        ["source", (batch) => ({ ...batch, sourceSha256: "e".repeat(64) })],
        ["artifact", (batch) => ({ ...batch, artifactSha256: "e".repeat(64) })],
        ["truncated", (batch) => ({ ...batch, truncated: "false" as never })],
        ["rows", (batch) => ({ ...batch, rows: Array.from({ length: PRIVATE_INDEX_ROWS + 1 }, () => batch.rows[0]!) })],
        ["bytes", (batch) => ({ ...batch, rows: [{ ...batch.rows[0]!, reasons: ["x".repeat(PRIVATE_INDEX_BYTES)] }] })]
    ])("rejects an invalid %s envelope before the rule context read", async (_, change) => {
        // 현재 검증 경기 조회 모의객체 생성
        const read = vi.fn(async () => lockedMatch);

        // 배치 봉투 위반 거부 확인
        await expect(
            incidentPlan(change(await privateBatch(true, declaredMatch)), planContext, read)
        ).rejects.toThrow("INCIDENT_BATCH_INVALID");
        // 봉투 검증 전에 잠금 조회가 실행되지 않음 확인
        expect(read).not.toHaveBeenCalled();
    });

    it.each<[string, (row: PrivateIncidentRow) => readonly PrivateIncidentRow[]]>([
        ["digest", (row) => [{ ...row, observationSha256: "0".repeat(64) }]],
        ["duplicate", (row) => [row, row]],
        ["admission", (row) => [{ ...row, admittedFactIds: [] } as PrivateIncidentRow]],
        ["evaluation", (row) => [{ ...row, evaluations: [] } as PrivateIncidentRow]],
        ["source", (row) => [{ ...row, observation: { ...row.observation, sourceSha256: "e".repeat(64) } }]],
        ["shape", (row) => [{ ...row, observation: { ...row.observation, schemaVersion: "x" as never } }]]
    ])("rejects a row with an invalid %s", async (_, change) => {
        // 유형별 사건 없는 배치 생성
        const batch = await privateBatch(false);

        // 관측 행 위반 거부 확인
        await expect(
            incidentPlan({ ...batch, rows: change(batch.rows[0]!) }, planContext, async () => lockedMatch)
        ).rejects.toThrow("INCIDENT_ROW_INVALID");
    });

    it.each<[string, VerifiedMatch | undefined]>([
        ["missing", undefined],
        ["different", { ...lockedMatch, matchDate: "2026-01-02" }]
    ])("rejects a verified record when the locked match is %s", async (_, current) => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);

        // 잠근 경기와 선언 경기 불일치 거부 확인
        await expect(incidentPlan(batch, planContext, async () => current)).rejects.toThrow(
            "INCIDENT_RULE_CONTEXT_CHANGED"
        );
    });

    it("never matches a verified declaration without a match id", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 첫 행 읽음
        const row = batch.rows[0]!;
        // 경기 식별자만 비운 검증 선언 행 생성
        const changed = { ...row, record: { ...row.record!, match: { ...declaredMatch, matchId: null } } };

        // 비어 있는 선언이 잠근 경기와 일치하지 않음 확인
        await expect(
            incidentPlan({ ...batch, rows: [changed] }, planContext, async () => lockedMatch)
        ).rejects.toThrow("INCIDENT_RULE_CONTEXT_CHANGED");
    });

    it.each<[string, typeof storedEvidence]>([
        ["missing", []],
        ["hash", [{ ...storedEvidence[0]!, contentSha256: "e".repeat(64) }]],
        ["interval", [{ ...storedEvidence[0]!, endMs: 101 }]]
    ])("rejects an observation whose stored evidence is %s", async (_, evidence) => {
        // 유형별 사건 없는 배치 생성
        const batch = await privateBatch(false);

        // 저장 시점 증거 불일치 거부 확인
        await expect(
            incidentPlan(batch, { ...planContext, evidence }, async () => lockedMatch)
        ).rejects.toThrow("INCIDENT_ROW_EVIDENCE_MISMATCH");
    });

    it.each<[string, (row: PrivateIncidentRow) => PrivateIncidentRow]>([
        ["hash", (row) => ({ ...row, recordSha256: "0".repeat(64) })],
        ["link", (row) => ({ ...row, link: null })],
        ["source", (row) => ({ ...row, record: { ...row.record!, sourceSha256: "e".repeat(64) } })]
    ])("rejects a record with a changed %s lineage", async (_, change) => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);

        // 사건 계보 불일치 거부 확인
        await expect(
            incidentPlan({ ...batch, rows: [change(batch.rows[0]!)] }, planContext, async () => lockedMatch)
        ).rejects.toThrow("INCIDENT_ROW_LINEAGE_MISMATCH");
    });

    it("rejects record evidence that is not bound to a verified observation reference", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 첫 행 읽음
        const row = batch.rows[0]!;
        // 관측에 없는 증거 해시를 주장하는 사건 생성
        const record = {
            ...row.record!,
            evidence: row.record!.evidence.map((item) => ({ ...item, contentSha256: "e".repeat(64) }))
        };
        // 바뀐 사건으로 다시 만든 계보 생성
        const link = incidentLineage(row.observation, record, row.link!.actionId);

        // 계보 자체는 유효하게 다시 만들어짐 확인
        expect(link).not.toBeNull();
        // 자기 해시와 계보가 맞아도 관측에 결합되지 않은 사건 증거 거부 확인
        await expect(
            incidentPlan(
                { ...batch, rows: [{ ...row, record, recordSha256: incidentDigest(record), link }] },
                planContext,
                async () => lockedMatch
            )
        ).rejects.toThrow("INCIDENT_RECORD_EVIDENCE_MISMATCH");
    });
});

describe("bounded batch", () => {
    // 용량 검사만을 위한 최소 행
    const tiny = {
        observation: {},
        observationSha256: "",
        record: null,
        recordSha256: null,
        link: null,
        reasons: []
    } as unknown as PrivateIncidentRow;
    // 최소 행으로 구성한 배치 봉투
    const envelope: PrivateIncidentBatch = {
        schemaVersion: "private-incidents-v1",
        sourceSha256: "a".repeat(64),
        artifactSha256: "b".repeat(64),
        truncated: false,
        rows: []
    };

    it("accepts the exact row limit and rejects one more row", () => {
        // 행 수 상한과 같은 배치 허용 확인
        expect(boundedBatch({ ...envelope, rows: Array.from({ length: PRIVATE_INDEX_ROWS }, () => tiny) })).toBe(true);
        // 행 수 상한을 하나 넘는 배치 거부 확인
        expect(boundedBatch({ ...envelope, rows: Array.from({ length: PRIVATE_INDEX_ROWS + 1 }, () => tiny) })).toBe(
            false
        );
    });

    it("measures serialized utf8 bytes at the exact byte limit", () => {
        // 빈 사유 하나를 담은 배치의 직렬화 바이트 수 계산
        const overhead = Buffer.byteLength(JSON.stringify({ ...envelope, rows: [{ ...tiny, reasons: [""] }] }));
        // 사유 길이로 전체 직렬화 크기를 조절한 배치 생성
        const sized = (reason: string) => ({ ...envelope, rows: [{ ...tiny, reasons: [reason] }] });

        // 바이트 상한과 정확히 같은 배치 허용 확인
        expect(boundedBatch(sized("x".repeat(PRIVATE_INDEX_BYTES - overhead)))).toBe(true);
        // 바이트 상한을 한 바이트 넘는 배치 거부 확인
        expect(boundedBatch(sized("x".repeat(PRIVATE_INDEX_BYTES - overhead + 1)))).toBe(false);
        // 문자 수가 상한보다 작아도 UTF 8 바이트가 넘으면 거부 확인
        expect(boundedBatch(sized("가".repeat(Math.ceil((PRIVATE_INDEX_BYTES - overhead) / 3) + 1)))).toBe(false);
    });
});
