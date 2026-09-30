// 비공개 사건 저장 어댑터의 잠금 조회와 쓰기 전 전체 검증 테스트
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { incidentRows } from "../../src/adapters/incidents";
import { declaredMatch, planContext, privateBatch } from "../fixtures/private-incident";

// 선언 경기와 같은 경기와 적용 규정 판본을 담은 잠금 조회 행
const locked = {
    match_id: "fixture-match",
    match_date: "2026-01-01",
    competition: "fixture",
    season: "fixture",
    ifab_edition: "2025-26"
};

// 실행된 질의를 기록하고 잠금 조회와 관측 저장 결과를 흉내 내는 트랜잭션 생성
const transaction = (options: Readonly<{ locked: boolean; saved: boolean }>) => {
    // 실행 질의 목록
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    // 질의 종류별 결과를 돌려주는 실행 모의객체
    const execute = vi.fn(async (statement: SQL) => {
        // 실행 질의 문자열과 인자 변환
        const query = new PgDialect().sqlToQuery(statement);
        // 실행 질의 기록
        queries.push(query);
        // 규정 문맥 잠금 조회 결과 반환
        if (query.sql.includes("for share of m, r")) return options.locked ? [locked] : [];
        // 관측 저장 결과 반환
        if (query.sql.includes("insert into analysis_incident_observations")) {
            return options.saved ? [{ id: "observation" }] : [];
        }
        // 그 밖의 질의 결과 없음 반환
        return [];
    });
    // 저장 경계가 요구하는 트랜잭션 형태로 맞춘 실행 모의객체
    const handle = { execute } as unknown as Parameters<typeof incidentRows>[0];
    return { queries, execute, handle };
};

// 결과 저장 트랜잭션이 전달하는 저장 문맥
const context = {
    ...planContext,
    analysisId: "analysis",
    jobId: "job",
    jobRevision: 1,
    now: "2026-09-29T00:00:00.000Z",
    expiresAt: "2026-10-29T00:00:00.000Z"
};

describe("private incident rows", () => {
    it("stores the observation and the server evaluated record after one locked match read", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 잠금 조회와 관측 저장이 성공하는 트랜잭션 생성
        const database = transaction({ locked: true, saved: true });

        // 저장 실행
        await incidentRows(database.handle, batch, context);

        // 잠금 조회 후 관측과 사건 순서로 저장됨 확인
        expect(database.queries.map((query) => query.sql.match(/for share of m, r|insert into \w+/)?.[0])).toEqual([
            "for share of m, r",
            "insert into analysis_incident_observations",
            "insert into analysis_incident_records"
        ]);
        // 사건 행이 방금 저장한 관측 행에 연결되고 승인 사실이 서버 계산값임 확인
        expect(database.queries[2]!.params).toEqual(expect.arrayContaining(["observation", "[]"]));
    });

    it("validates every row before the first write", async () => {
        // 유형별 사건 없는 배치 생성
        const batch = await privateBatch(false);
        // 모든 질의가 성공하는 트랜잭션 생성
        const database = transaction({ locked: true, saved: true });

        // 첫 행은 유효하고 둘째 행이 중복인 배치 거부 확인
        await expect(
            incidentRows(database.handle, { ...batch, rows: [batch.rows[0]!, batch.rows[0]!] }, context)
        ).rejects.toThrow("INCIDENT_ROW_INVALID");
        // 유효한 첫 행도 저장하지 않음 확인
        expect(database.execute).not.toHaveBeenCalled();
    });

    it("writes nothing when a later verified row fails after the locked match read", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 모든 질의가 성공하는 트랜잭션 생성
        const database = transaction({ locked: true, saved: true });
        // 첫 행 읽음
        const row = batch.rows[0]!;

        // 둘째 행 계보가 바뀐 배치 거부 확인
        await expect(
            incidentRows(
                database.handle,
                { ...batch, rows: [row, { ...row, observationSha256: "0".repeat(64) }] },
                context
            )
        ).rejects.toThrow("INCIDENT_ROW_INVALID");
        // 잠금 조회 한 번 외에 쓰기가 없음 확인
        expect(database.queries.map((query) => query.sql.includes("for share of m, r"))).toEqual([true]);
    });

    it("rejects a verified record without a locked match and writes nothing", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 잠금 조회 결과가 없는 트랜잭션 생성
        const database = transaction({ locked: false, saved: true });

        // 현재 검증 경기 부재 거부 확인
        await expect(incidentRows(database.handle, batch, context)).rejects.toThrow("INCIDENT_RULE_CONTEXT_CHANGED");
        // 잠금 조회 외에 쓰기가 없음 확인
        expect(database.execute).toHaveBeenCalledOnce();
    });

    it("cancels the storage when the observation insert returns no row", async () => {
        // 검증 경기를 선언한 잡기 사건 배치 생성
        const batch = await privateBatch(true, declaredMatch);
        // 관측 저장 결과가 비어 있는 트랜잭션 생성
        const database = transaction({ locked: true, saved: false });

        // 관측 저장 실패 거부 확인
        await expect(incidentRows(database.handle, batch, context)).rejects.toThrow("INCIDENT_ROW_NOT_SAVED");
        // 사건 행 저장이 실행되지 않음 확인
        expect(database.queries.some((query) => query.sql.includes("insert into analysis_incident_records"))).toBe(
            false
        );
    });
});
