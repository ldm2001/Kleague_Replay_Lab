import type { VarFacts } from "@replay/shared-types";
import { loadRuleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { evaluateVar } from "../src/index.js";

const rules2025 = loadRuleSet("ifab-2025-26")!;

const base: VarFacts = {
  reviewScenario: "PENALTY_NOT_GIVEN",
  restartOccurred: false,
  sendOffCategory: "NONE",
  mistakenIdentity: false,
  decisionNature: "SUBJECTIVE",
  errorMagnitude: "CLEAR_AND_OBVIOUS",
  seriousMissedIncident: false,
};

const assess = (facts: Partial<VarFacts>, options = {}) => {
  const outcome = evaluateVar({ ...base, ...facts }, rules2025, options);
  if (!outcome.ok) throw new Error(`예상치 못한 오류: ${outcome.error}`);
  return outcome.assessment;
};

describe("evaluateVar", () => {
  it("네 게이트가 전부 별도 필드로 나온다", () => {
    const assessment = assess({});
    expect(Object.keys(assessment)).toEqual(
      expect.arrayContaining([
        "category",
        "withinTimeWindow",
        "thresholdMet",
        "reviewProcedure",
      ]),
    );
    expect(assessment.category).toBe("PENALTY_NO_PENALTY");
    expect(assessment.withinTimeWindow).toBe(true);
    expect(assessment.thresholdMet).toBe("MET");
    expect(assessment.reviewProcedure).toBe("OFR");
  });

  it("범주 밖이면 오심 정도와 무관하게 검토 불가다", () => {
    const assessment = assess({ reviewScenario: "OTHER" });
    expect(assessment.reviewable).toBe(false);
    expect(assessment.category).toBe("NONE");
    expect(assessment.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
    expect(assessment.noInterventionReason).toBe("NOT_REVIEWABLE");
    expect(assessment.reviewProcedure).toBe("NONE");
    // 문턱은 여전히 별도로 계산된다
    expect(assessment.thresholdMet).toBe("MET");
  });

  it("주심이 판정을 내렸다는 사실만으로는 검토 창이 닫히지 않는다", () => {
    const assessment = assess({ restartOccurred: false });
    expect(assessment.withinTimeWindow).toBe(true);
    expect(assessment.windowClosedReason).toBeNull();
  });

  it("검토 창을 닫는 것은 재개뿐이다", () => {
    const assessment = assess({ restartOccurred: true });
    expect(assessment.withinTimeWindow).toBe(false);
    expect(assessment.windowClosedReason).toBe("PLAY_RESTARTED");
    expect(assessment.noInterventionReason).toBe("TOO_LATE");
  });

  it("폭력 행위 퇴장은 재개 뒤에도 창이 열려 있다", () => {
    const assessment = assess({
      reviewScenario: "SENDING_OFF_NOT_GIVEN",
      restartOccurred: true,
      sendOffCategory: "VIOLENT_CONDUCT",
    });
    expect(assessment.withinTimeWindow).toBe(true);
    expect(assessment.windowException).toBe("VIOLENT_CONDUCT");
    expect(assessment.windowClosedReason).toBeNull();
  });

  it("검토 대상이면서 개입하지 않은 상태를 만들 수 있다", () => {
    const assessment = assess({ errorMagnitude: "NOT_CLEAR_AND_OBVIOUS" });
    expect(assessment.reviewable).toBe(true);
    expect(assessment.thresholdMet).toBe("NOT_MET");
    expect(assessment.intervention).toBe("NO_INTERVENTION");
    expect(assessment.noInterventionReason).toBe("THRESHOLD_NOT_MET");
  });

  it("문턱이 미확정이면 사유를 지어내지 않는다", () => {
    const assessment = assess({ errorMagnitude: "UNDETERMINED" });
    expect(assessment.thresholdMet).toBe("UNDETERMINED");
    expect(assessment.intervention).toBe("NO_INTERVENTION");
    expect(assessment.noInterventionReason).toBeNull();
  });

  it("절차는 사실적·주관적 구분에서만 나오고 문턱과 무관하다", () => {
    expect(assess({ decisionNature: "FACTUAL" }).reviewProcedure).toBe("VAR_ONLY");
    expect(assess({ decisionNature: "FACTUAL", errorMagnitude: "NOT_CLEAR_AND_OBVIOUS" }).reviewProcedure).toBe(
      "VAR_ONLY",
    );
  });

  it("2025/26에서 2차 경고는 검토 범주가 아니다", () => {
    const assessment = assess({ reviewScenario: "SECOND_CAUTION" });
    expect(assessment.reviewable).toBe(false);
    expect(assessment.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
  });

  it("결과에 인용과 서명이 함께 붙는다", () => {
    const outcome = evaluateVar(base, rules2025, {});
    if (!outcome.ok) throw new Error("예상치 못한 오류");
    expect(outcome.citations.length).toBeGreaterThanOrEqual(1);
    expect(outcome.factSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.factSignatureInput).not.toContain("competition");
  });
});
