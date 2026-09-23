import type { VarFacts } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { varResult } from "@replay/rule-engine";

// 시험자료 시험용 규정집 결과 준비
const rules2025 = ruleSet("ifab-2025-26")!;

// 기본자료 시험 입력으로 판독시나리오 페널티 및 재개 거짓 및 전송 분류 없음 및 대상착오 거짓 자료 생성
const base: VarFacts = {
    reviewScenario: "PENALTY_NOT_GIVEN",
    restartOccurred: false,
    sendOffCategory: "NONE",
    mistakenIdentity: false,
    decisionNature: "SUBJECTIVE",
    errorMagnitude: "CLEAR_AND_OBVIOUS",
    seriousMissedIncident: false,
};

// 검증용 사례 결과 구성
const caseResult = (facts: Partial<VarFacts>, options = {}) => {
    // 처리결과 시험용 비디오판독 결과 준비
    const outcome = varResult({ ...base, ...facts }, rules2025, options);
    // 처리결과 부정 조건에 따른 처리 경로 분기
    if (!outcome.ok) throw new Error(`예상치 못한 오류: ${outcome.error}`);
    // 처리결과 평가 반환
    return outcome.assessment;
};

describe("varResult", () => {
    it("문턱 충족은 실제 원심 변경이 아닌 개입 권고다", () => {
        // 사례 결과의 기대값 지정 문자열 일치 확인
        expect(caseResult({}).intervention).toBe("INTERVENTION_RECOMMENDED");
    });

    it.each(["restartOccurred", "mistakenIdentity", "seriousMissedIncident"] as const)(
        "%s 미확인은 false로 처리하지 않는다",
        (field) => {
            // 처리결과 시험용 비디오판독 결과 준비
            const outcome = varResult({ ...base, [field]: null }, rules2025, {});
            // 사실 부족 내용을 포함한 기대 결과 일치 확인
            expect(outcome).toMatchObject({ ok: false, error: "INSUFFICIENT_FACTS" });
        }
    );
    it("네 게이트가 전부 별도 필드로 나온다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({});
        // 객체 키목록 결과의 시험자료 부분배열 결과 기준 구조 일치 확인
        expect(Object.keys(assessment)).toEqual(
            expect.arrayContaining([
                "category",
                "withinTimeWindow",
                "thresholdMet",
                "reviewProcedure"
            ])
        );
        // 평가 분류의 기대값 페널티 페널티 일치 확인
        expect(assessment.category).toBe("PENALTY_NO_PENALTY");
        // 평가 시간의 기대값 참 일치 확인
        expect(assessment.withinTimeWindow).toBe(true);
        // 평가 임계충족여부의 기대값 지정 문자열 일치 확인
        expect(assessment.thresholdMet).toBe("MET");
        // 평가의 기대값 지정 문자열 일치 확인
        expect(assessment.reviewProcedure).toBe("OFR");
    });

    it("범주 밖이면 오심 정도와 무관하게 검토 불가다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ reviewScenario: "OTHER" });
        // 평가의 기대값 거짓 일치 확인
        expect(assessment.reviewable).toBe(false);
        // 평가 분류의 기대값 없음 일치 확인
        expect(assessment.category).toBe("NONE");
        // 평가 사유의 기대값 지정 문자열 일치 확인
        expect(assessment.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
        // 결과가 검토 대상 아님 상태로 유지됨 확인
        expect(assessment.noInterventionReason).toBe("NOT_REVIEWABLE");
        // 평가의 기대값 없음 일치 확인
        expect(assessment.reviewProcedure).toBe("NONE");
        // 문턱 결과 독립 확인
        expect(assessment.thresholdMet).toBe("MET");
    });

    it("주심이 판정을 내렸다는 사실만으로는 검토 창이 닫히지 않는다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ restartOccurred: false });
        // 평가 시간의 기대값 참 일치 확인
        expect(assessment.withinTimeWindow).toBe(true);
        // 평가 종료여부 사유의 빈 값 확인
        expect(assessment.windowClosedReason).toBeNull();
    });

    it("검토 창을 닫는 것은 재개뿐이다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ restartOccurred: true });
        // 평가 시간의 기대값 거짓 일치 확인
        expect(assessment.withinTimeWindow).toBe(false);
        // 평가 종료여부 사유의 기대값 지정 문자열 일치 확인
        expect(assessment.windowClosedReason).toBe("PLAY_RESTARTED");
        // 평가 사유의 기대값 지정 문자열 일치 확인
        expect(assessment.noInterventionReason).toBe("TOO_LATE");
    });

    it("폭력 행위 퇴장은 재개 뒤에도 창이 열려 있다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({
            reviewScenario: "SENDING_OFF_NOT_GIVEN",
            restartOccurred: true,
            sendOffCategory: "VIOLENT_CONDUCT"
        });
        // 평가 시간의 기대값 참 일치 확인
        expect(assessment.withinTimeWindow).toBe(true);
        // 평가의 기대값 지정 문자열 일치 확인
        expect(assessment.windowException).toBe("VIOLENT_CONDUCT");
        // 평가 종료여부 사유의 빈 값 확인
        expect(assessment.windowClosedReason).toBeNull();
    });

    it("검토 대상이면서 개입하지 않은 상태를 만들 수 있다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ errorMagnitude: "NOT_CLEAR_AND_OBVIOUS" });
        // 평가의 기대값 참 일치 확인
        expect(assessment.reviewable).toBe(true);
        // 결과가 기준 미충족 상태로 유지됨 확인
        expect(assessment.thresholdMet).toBe("NOT_MET");
        // 결과가 개입 없음 상태로 유지됨 확인
        expect(assessment.intervention).toBe("NO_INTERVENTION");
        // 결과가 개입 임계 기준 미충족 상태로 유지됨 확인
        expect(assessment.noInterventionReason).toBe("THRESHOLD_NOT_MET");
    });

    it("문턱이 미확정이면 사유를 지어내지 않는다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ errorMagnitude: "UNDETERMINED" });
        // 결과가 미확정 상태로 유지됨 확인
        expect(assessment.thresholdMet).toBe("UNDETERMINED");
        // 결과가 미확정 상태로 유지됨 확인
        expect(assessment.intervention).toBe("UNDETERMINED");
        // 평가 사유의 빈 값 확인
        expect(assessment.noInterventionReason).toBeNull();
    });

    it("절차는 사실적·주관적 구분에서만 나오고 문턱과 무관하다", () => {
        // 사례 결과의 기대값 비디오판독 일치 확인
        expect(caseResult({ decisionNature: "FACTUAL" }).reviewProcedure).toBe("VAR_ONLY");
        // 사실 판정에 맞는 비디오판독 전용 검토 절차 선택 확인
        expect(
            caseResult({ decisionNature: "FACTUAL", errorMagnitude: "NOT_CLEAR_AND_OBVIOUS" })
                .reviewProcedure
        ).toBe("VAR_ONLY");
    });

    it("2025/26에서 2차 경고는 검토 범주가 아니다", () => {
        // 평가 시험용 사례 결과 준비
        const assessment = caseResult({ reviewScenario: "SECOND_CAUTION" });
        // 평가의 기대값 거짓 일치 확인
        expect(assessment.reviewable).toBe(false);
        // 평가 사유의 기대값 지정 문자열 일치 확인
        expect(assessment.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
    });

    it("결과에 인용과 서명이 함께 붙는다", () => {
        // 처리결과 시험용 비디오판독 결과 준비
        const outcome = varResult(base, rules2025, {});
        // 처리결과 부정 조건에 따른 처리 경로 분기
        if (!outcome.ok) throw new Error("예상치 못한 오류");
        // 처리결과 인용목록 길이의 1 이상 확인
        expect(outcome.citations.length).toBeGreaterThanOrEqual(1);
        // 처리결과 사실 서명의 지정 패턴 일치 확인
        expect(outcome.factSignature).toMatch(/^[0-9a-f]{64}$/);
        // 처리결과 사실 서명 입력의 대회 미포함 확인
        expect(outcome.factSignatureInput).not.toContain("competition");
    });
});
