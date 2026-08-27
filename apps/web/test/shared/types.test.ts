import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  EvaluationResult,
  Observed,
  RuleCitation,
  VarAssessment,
  VarOutcome,
} from "@replay/shared-types";
import { isEvaluationFailure, observed } from "@replay/shared-types";

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
    const fact: Observed<boolean> = observed(true, "NORMAL", ["shot-1"]);
    expect(fact).toEqual({ value: true, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] });
  });

  it("VarAssessment의 네 게이트는 서로 다른 필드다", () => {
    expectTypeOf<VarAssessment>().toHaveProperty("category");
    expectTypeOf<VarAssessment>().toHaveProperty("withinTimeWindow");
    expectTypeOf<VarAssessment>().toHaveProperty("thresholdMet");
    expectTypeOf<VarAssessment>().toHaveProperty("reviewProcedure");
  });

  it("검토 대상이면서 개입하지 않은 상태를 표현할 수 있다", () => {
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
    expect(assessment.reviewable).toBe(true);
    expect(assessment.intervention).toBe("NO_INTERVENTION");
  });

  it("citations는 비어 있을 수 없다는 계약을 런타임 헬퍼로 확인한다", () => {
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
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
  });

  it("오류 결과는 판정 결과와 다른 형태다", () => {
    const outcome: VarOutcome = {
      ok: false,
      error: "UNKNOWN_COMPETITION_OPTION",
      message: "corner_kick_review 채택 여부가 주어지지 않음",
    };
    expect(isEvaluationFailure(outcome)).toBe(true);
  });
});
