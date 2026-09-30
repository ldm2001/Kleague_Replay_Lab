import { describe, expect, it } from "vitest";
import { automaticJudgments, validAutomaticBatch } from "../../src/adapters/binding";
import type { AutomaticReviewBatch } from "../../src/shared/review";
import { judgment } from "../fixtures/result";

// 시험자료 시험 입력으로 버전 자동평가 및 분석 식별자 분석 및 작업 식별자 작업 및 작업 개정번호 1 자료 생성
const batch: AutomaticReviewBatch = {
    version: "automatic-review-v1",
    analysisId: "analysis",
    jobId: "job",
    jobRevision: 1,
    sourceSha256: "a".repeat(64),
    pipelineVersion: "video-local-observers-v1",
    videoCoverage: "PARTIAL",
    summaryTruncated: false,
    evaluatedCount: 0,
    blockedCount: 1,
    rows: [
        {
            candidateIndex: 0,
            question: "PUSHING",
            status: "BLOCKED",
            reasonCodes: ["UNSUPPORTED"],
            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
            evidenceIndices: [],
            producer: null,
            rule: null,
            facts: null,
            result: null
        }
    ]
};
// 맥락 시험 입력으로 분석 식별자 분석 및 작업 식별자 작업 및 작업 개정번호 1 및 원본 해시 자료 생성
const context = {
    analysisId: "analysis",
    jobId: "job",
    jobRevision: 1,
    sourceSha256: "a".repeat(64),
    pipelineVersion: "video-local-observers-v1",
    candidateIndices: [0],
    evidence: [],
    rule: null
};
describe("automatic batch binding", () => {
    it("stores blocked work without inventing verified context", () =>
        expect(validAutomaticBatch(batch, context)).toBe(true));
    it("rejects crossed job/revision/source/pipeline/candidate bindings", () => {
        // 5개 항목 목록의 각 사례 순회
        for (const patch of [
            { jobId: "other" },
            { jobRevision: 2 },
            { sourceSha256: "b".repeat(64) },
            { pipelineVersion: "other" },
            { candidateIndices: [1] }
        ]) {
            // 유효 자동평가 결과의 기대값 거짓 일치 확인
            expect(validAutomaticBatch(batch, { ...context, ...patch })).toBe(false);
        }
    });
    it("rejects fabricated completed rows and inconsistent counts", () => {
        // 유효 자동평가 결과의 기대값 거짓 일치 확인
        expect(validAutomaticBatch({ ...batch, evaluatedCount: 1 }, context)).toBe(false);
        // 유효 자동평가 결과의 기대값 거짓 일치 확인
        expect(
            validAutomaticBatch(
                {
                    ...batch,
                    evaluatedCount: 1,
                    blockedCount: 0,
                    rows: [{ ...batch.rows[0]!, status: "COMPLETED" }]
                },
                context
            )
        ).toBe(false);
    });
    it("fails closed for partial coverage even with completed row data", () => {
        // 완료 규정 연결 시험용 시험자료 결과 준비
        const { completed, rule, binding } = fixture();
        // 유효 자동평가 결과의 기대값 거짓 일치 확인
        expect(
            validAutomaticBatch(
                { ...completed, videoCoverage: "PARTIAL" },
                { ...context, rule, evidence: [binding] }
            )
        ).toBe(false);
        // 자동평가 결과 크기의 기대값 0 일치 확인
        expect(
            automaticJudgments({ ...completed, summaryTruncated: true }, [binding], [binding], rule)
                .size
        ).toBe(0);
    });
    it("exposes only live immutable matching evidence and current rule pins", () => {
        // 완료 규정 연결 시험용 시험자료 결과 준비
        const { completed, rule, binding } = fixture();
        // 자동평가 결과 조회 결과 근거 식별자목록의 1개 항목 목록 기준 구조 일치 확인
        expect(
            automaticJudgments(completed, [binding], [binding], rule).get(0)?.evidenceIds
        ).toEqual(["evidence"]);
        // 5개 항목 목록의 각 사례 순회
        for (const patch of [
            { contentSha256: "b".repeat(64) },
            { objectKey: "other" },
            { candidateIndex: 1 },
            { startMs: 1 },
            { evidenceId: "other" }
        ]) {
            // 자동평가 결과 크기의 기대값 0 일치 확인
            expect(
                automaticJudgments(completed, [binding], [{ ...binding, ...patch }], rule).size
            ).toBe(0);
        }
        // 자동평가 결과 크기의 기대값 0 일치 확인
        expect(automaticJudgments(completed, [binding], [], rule).size).toBe(0);
        // 자동평가 결과 크기의 기대값 0 일치 확인
        expect(
            automaticJudgments(completed, [binding], [binding], { ...rule, ifabVersionId: "other" })
                .size
        ).toBe(0);
        // 응답본문 직렬화 결과의 객체 키 미포함 확인
        expect(
            JSON.stringify(automaticJudgments(completed, [binding], [binding], rule).get(0))
        ).not.toContain("objectKey");
        // 응답본문 직렬화 결과의 사실 서명 입력 미포함 확인
        expect(
            JSON.stringify(automaticJudgments(completed, [binding], [binding], rule).get(0))
        ).not.toContain("factSignatureInput");
    });
    it("requires a conclusive complete rules result and a clip", () => {
        // 완료 규정 연결 시험용 시험자료 결과 준비
        const { completed, rule, binding } = fixture();
        // 4개 항목 목록의 각 사례 순회
        for (const patch of [
            { decision: "OUT_OF_SCOPE" as const },
            { restart: null },
            { disciplinary: null },
            { citations: [] }
        ]) {
            // 시험자료 시험 입력으로 기존 항목 및 행목록 자료 생성
            const modified = {
                ...completed,
                rows: [
                    { ...completed.rows[0]!, result: { ...completed.rows[0]!.result!, ...patch } }
                ]
            };
            // 자동평가 결과 크기의 기대값 0 일치 확인
            expect(automaticJudgments(modified, [binding], [binding], rule).size).toBe(0);
        }
    });
});

// 검증용 입력 모형 구성
function fixture() {
    // 규정 시험 입력으로 식별자 규정 및 경기 식별자 경기 및 대회 지정 문자열 및 시즌 2026 자료 생성
    const rule = {
        id: "rule",
        matchId: "match",
        competition: "K리그1",
        season: "2026",
        ifabVersionId: "ifab-2026-27",
        verificationStatus: "VERIFIED" as const
    };
    // 연결 시험 입력으로 근거 순번 0 및 근거 식별자 근거 및 후보 순번 0 및 종류 자료 생성
    const binding = {
        evidenceIndex: 0,
        evidenceId: "evidence",
        candidateIndex: 0,
        kind: "CLIP" as const,
        objectKey: `evidence/analysis/job/1/${"a".repeat(64)}/clip.mp4`,
        contentSha256: "a".repeat(64),
        startMs: 0,
        endMs: 1000,
        width: null,
        height: null
    };
    // 완료 시험 입력으로 기존 항목 및 영상분석범위 전체 및 평가완료 개수 1 및 보류 개수 0 자료 생성
    const completed: AutomaticReviewBatch = {
        ...batch,
        videoCoverage: "FULL",
        evaluatedCount: 1,
        blockedCount: 0,
        rows: [
            {
                ...batch.rows[0]!,
                status: "COMPLETED",
                rule,
                // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                evidenceIndices: [0],
                facts: judgment.facts.push,
                producer: {
                    methodId: "test",
                    version: "1",
                    validationReportSha256: "c".repeat(64)
                },
                result: {
                    ...judgment,
                    citations: [...judgment.citations],
                    accounts: [],
                    conflicts: [],
                    narrowedTo: [],
                    blockedFrom: [],
                    factSignature: "signature",
                    factSignatureInput: "input"
                }
            }
        ]
    };
    // 완료 및 규정 및 연결 자료 반환
    return { completed, rule, binding };
}
