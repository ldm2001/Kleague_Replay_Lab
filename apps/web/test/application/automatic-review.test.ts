import { describe, expect, it } from "vitest";
import { automaticReview } from "../../src/application/use-cases/evaluation/automatic";
import {
    perceptionPayload,
    PERCEPTION_ANALYSIS_ID,
    PERCEPTION_JOB_ID
} from "../fixtures/perception";
import { context } from "../fixtures/push-context";
import { observation } from "@replay/shared-types";

// 사실생산자 시험 입력으로 방법 식별자 지정 문자열 및 버전 1 및 보고서 해시 자료 생성
const producer = {
    methodId: "test-only-pushing",
    version: "1",
    validationReportSha256: "d".repeat(64)
};
// 사실 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
const facts = {
    contactDetected: observation(true, "NORMAL", []),
    severity: observation("CARELESS" as const, "NORMAL", []),
    opponentDisplacement: observation("none" as const, "NORMAL", []),
    insidePenaltyArea: observation(false, "NORMAL", []),
    cameraSufficiency: "HIGH" as const,
    context: context()
};

// 검증용 입력 구성
const input = () => {
    // 전송자료 시험용 인식전송자료 결과 준비
    const payload = perceptionPayload();
    // 분석 식별자 및 작업 식별자 및 작업 개정번호 2 및 영상길이 2_000 자료 반환
    return {
        analysisId: PERCEPTION_ANALYSIS_ID,
        jobId: PERCEPTION_JOB_ID,
        jobRevision: 2,
        durationMs: 2_000,
        pipelineVersion: payload.pipelineVersion,
        sourceSha256: payload.perception!.sourceSha256,
        perception: payload.perception!,
        candidates: payload.candidates,
        // 후보별 근거 위치와 내용 해시를 대조할 참조 목록 구성
        references: [
            {
                evidenceIndex: 0,
                candidateIndex: 1,
                kind: "CLIP" as const,
                startMs: 500,
                endMs: 1_500,
                contentSha256: "c".repeat(64),
                immutable: true
            }
        ],
        rule: {
            id: "44444444-4444-4444-8444-444444444444",
            matchId: "55555555-5555-4555-8555-555555555555",
            competition: "K리그2",
            season: "2026",
            ifabVersionId: "ifab-2025-26",
            verificationStatus: "VERIFIED" as const
        }
    };
};
// 이 생산자는 양성 연결 시험 전용이며 운영 승인 목록에 등록 제외
const ready = {
    registry: [producer],
    produce: () => ({ kind: "READY" as const, producer, facts, evidenceIndices: [0] })
};

describe("automatic server rule review", () => {
    it("runs every candidate but current observers do not manufacture facts", () => {
        // 시험 입력에 대한 자동 규정 평가 실행
        const result = automaticReview(input());
        // 결과의 영상분석범위 전체 및 평가완료 개수 0 및 보류 개수 1 자료의 필드 일치 확인
        expect(result).toMatchObject({ videoCoverage: "FULL", evaluatedCount: 0, blockedCount: 1 });
        // 평가 보류 내용을 포함한 기대 결과 일치 확인
        expect(result.rows[0]).toMatchObject({ status: "BLOCKED", facts: null, result: null });
        // 사실 생산자 미검증 값이 결과에 포함됨 확인
        expect(result.rows[0]?.reasonCodes).toContain("FACT_PRODUCER_UNVERIFIED");
    });

    it("evaluates a server-verified test producer and retains evidence and rule identity", () => {
        // 시험 입력에 대한 자동 규정 평가 실행
        const result = automaticReview(input(), ready);
        // 결과 평가완료 개수의 기대값 1 일치 확인
        expect(result.evaluatedCount).toBe(1);
        // 결과 행목록 중 선택 항목의 상태 완료 및 질문 밀기 및 근거 순번목록 및 결과 자료의 필드 일치 확인
        expect(result.rows[0]).toMatchObject({
            status: "COMPLETED",
            question: "PUSHING",
            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
            evidenceIndices: [0],
            result: {
                decision: "FOUL",
                restart: "DIRECT_FREE_KICK",
                disciplinary: "NONE",
                varAssessment: null
            }
        });
    });

    it.each(["contactDetected", "insidePenaltyArea"] as const)(
        "never completes unknown %s",
        (field) => {
            // 시험 입력에 대한 자동 규정 평가 실행
            const result = automaticReview(input(), {
                ...ready,
                produce: () => ({
                    kind: "READY",
                    producer,
                    facts: { ...facts, [field]: observation(null, "NORMAL", []) },
                    // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                    evidenceIndices: [0]
                })
            });
            // 결과의 평가 보류 상태 일치 확인
            expect(result.rows[0]?.status).toBe("BLOCKED");
            // 결과 평가완료 개수의 기대값 0 일치 확인
            expect(result.evaluatedCount).toBe(0);
        }
    );

    it("does not trust an unregistered producer even when it returns complete-looking facts", () => {
        // 사실 생산자 미검증 값이 결과에 포함됨 확인
        expect(automaticReview(input(), { ...ready, registry: [] }).rows[0]?.reasonCodes).toContain(
            "FACT_PRODUCER_UNVERIFIED"
        );
    });

    it("rejects malformed producer facts even from a registered implementation", () => {
        // 시험 입력에 대한 자동 규정 평가 실행
        const result = automaticReview(input(), {
            ...ready,
            produce: () => ({
                kind: "READY",
                producer,
                facts: { ...facts, severity: observation("INVALID", "NORMAL", []) } as never,
                // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                evidenceIndices: [0]
            })
        });
        // 결과 평가완료 개수의 기대값 0 일치 확인
        expect(result.evaluatedCount).toBe(0);
        // 사실 자료 형식 오류 사유가 결과에 포함됨 확인
        expect(result.rows[0]?.reasonCodes).toContain("FACT_SCHEMA_INVALID");
    });

    it("does not infer a rule edition", () => {
        // 규정 판본 미검증 값이 결과에 포함됨 확인
        expect(automaticReview({ ...input(), rule: null }, ready).rows[0]?.reasonCodes).toContain(
            "RULE_EDITION_UNVERIFIED"
        );
    });

    it("requires immutable evidence covering the entire incident", () => {
        // 3개 항목 목록의 각 사례 순회
        for (const references of [
            [],
            [{ ...input().references[0]!, immutable: false }],
            [{ ...input().references[0]!, endMs: 700 }]
        ]) {
            // 결과의 평가 보류 상태 일치 확인
            expect(automaticReview({ ...input(), references }, ready).rows[0]?.status).toBe(
                "BLOCKED"
            );
        }
    });

    it("records partial/truncated whole-video coverage without claiming all fouls were checked", () => {
        // 값 시험용 입력 결과 준비
        const value = input();
        // 값 인식을 기존 항목 및 요약 자료로 설정
        value.perception = {
            ...value.perception,
            summary: { ...value.perception.summary, truncated: true }
        };
        // 자동규정평가 결과의 영상분석범위 부분 및 요약 잘림여부 참 및 평가완료 개수 0 자료의 필드 일치 확인
        expect(automaticReview({ ...value, durationMs: 3_000 }, ready)).toMatchObject({
            videoCoverage: "PARTIAL",
            summaryTruncated: true,
            evaluatedCount: 0
        });
    });

    it("does not turn raw proposals or a claimed Worker judgment into a pushing event", () => {
        // 값 시험용 입력 결과 준비
        const value = input();
        // 값 인식을 기존 항목 및 사건목록 자료로 설정
        value.perception = { ...value.perception, incidents: [] };
        // 자동규정평가 결과 행목록 중 선택 항목 사유코드목록의 사건미인식 포함 확인
        expect(automaticReview(value, ready).rows[0]?.reasonCodes).toContain(
            "INCIDENT_UNRECOGNIZED"
        );
    });
});
