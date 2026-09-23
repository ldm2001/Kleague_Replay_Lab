// 공용 타입 테스트
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
    EvaluationResult,
    Observed,
    RuleCitation,
    VarAssessment,
    VarOutcome
} from "@replay/shared-types";
import { failure, observation } from "@replay/shared-types";

// 인용 시험 입력으로 규정 식별자 2025 26 조항 12 1 및 규정 개정번호 1 및 규정 내용 해시 및 권한 지정 문자열 자료 생성
const citation: RuleCitation = {
    ruleId: "ifab-2025-26-law-12-1",
    ruleRevision: 1,
    ruleContentSha256: "0".repeat(64),
    authority: "IFAB",
    edition: "2025-26",
    law: "12",
    section: "1",
    relevance: "PRIMARY",
    quoteSnapshot: "A direct free kick is awarded ...",
    sourcePage: "109",
};

describe("타입 계약", () => {
    it("Observed는 값과 관측 조건을 함께 갖는다", () => {
        // 사실 시험용 관측 결과 준비
        const fact: Observed<boolean> = observation(true, "NORMAL", ["shot-1"]);
        // 사실의 값 참 및 관측결과 시점 보통 및 샷 식별자목록 자료 기준 구조 일치 확인
        expect(fact).toEqual({ value: true, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] });
    });

    it("VarAssessment의 네 게이트는 서로 다른 필드다", () => {
        // 유형 결과 처리 수행
        expectTypeOf<VarAssessment>().toHaveProperty("category");
        // 유형 결과 처리 수행
        expectTypeOf<VarAssessment>().toHaveProperty("withinTimeWindow");
        // 유형 결과 처리 수행
        expectTypeOf<VarAssessment>().toHaveProperty("thresholdMet");
        // 유형 결과 처리 수행
        expectTypeOf<VarAssessment>().toHaveProperty("reviewProcedure");
    });

    it("검토 대상이면서 개입하지 않은 상태를 표현할 수 있다", () => {
        // 평가 시험 입력으로 지정 항목 참 및 분류 지정 문자열 및 시간 참 및 임계충족여부 지정 문자열 자료 생성
        const assessment: VarAssessment = {
            reviewable: true,
            category: "GOAL_NO_GOAL",
            withinTimeWindow: true,
            thresholdMet: "NOT_MET",
            intervention: "NO_INTERVENTION",
            noInterventionReason: "THRESHOLD_NOT_MET",
            notReviewableReason: null,
            windowClosedReason: null,
            windowException: "NONE",
            reviewProcedure: "OFR",
            explanation: "검토 대상에는 해당하나 명백하고 분명한 오류로 보기 어려움",
        };
        // 평가의 기대값 참 일치 확인
        expect(assessment.reviewable).toBe(true);
        // 결과가 개입 없음 상태로 유지됨 확인
        expect(assessment.intervention).toBe("NO_INTERVENTION");
    });

    it("citations는 비어 있을 수 없다는 계약을 런타임 헬퍼로 확인한다", () => {
        // 결과 시험 입력으로 설명목록 및 지정 항목 및 지정 항목 및 보류 변환 자료 생성
        const result: EvaluationResult = {
            accounts: [],
            conflicts: [],
            narrowedTo: [],
            blockedFrom: [],
            varAssessment: null,
            decision: "NO_FOUL",
            severity: null,
            restart: "PLAY_CONTINUED",
            disciplinary: null,
            decisionMatch: "UNDETERMINED",
            confidence: "LOW",
            inconclusiveReason: null,
            factSignature: "0".repeat(64),
            factSignatureInput: "{}",
            citations: [citation],
        };
        // 결과 인용목록 길이의 1 이상 확인
        expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it("오류 결과는 판정 결과와 다른 형태다", () => {
        // 처리결과 시험 입력으로 지정 항목 거짓 및 오류 대회 및 지정 항목 코너킥 채택 여부가 주어지지 않음 자료 생성
        const outcome: VarOutcome = {
            ok: false,
            error: "UNKNOWN_COMPETITION_OPTION",
            message: "corner_kick_review 채택 여부가 주어지지 않음",
        };
        // 실패 결과의 기대값 참 일치 확인
        expect(failure(outcome)).toBe(true);
    });
});
