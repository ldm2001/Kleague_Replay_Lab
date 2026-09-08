// 평가 엔진 테스트
import { describe, expect, it } from "vitest";
import type { CompetitionOptions, PushFacts, VarFacts } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { assessment } from "./assessment.js";

const push: PushFacts = {
  contactDetected: { value: true, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
  severity: { value: "RECKLESS", observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
  opponentDisplacement: { value: "clear", observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
  insidePenaltyArea: { value: false, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
  cameraSufficiency: "HIGH",
};

const variable: VarFacts = {
  reviewScenario: "GOAL_DISALLOWED",
  restartOccurred: false,
  sendOffCategory: "NONE",
  mistakenIdentity: false,
  decisionNature: "SUBJECTIVE",
  errorMagnitude: "UNDETERMINED",
  seriousMissedIncident: false,
};

const observed = {
  restartType: "UNKNOWN", restartBeneficiary: "UNKNOWN", card: null,
  goalDecision: "UNKNOWN", source: "USER_INPUT",
} as const;

// 규정 평가 유스케이스 테스트
describe("assessment", () => {
  it("combines pushing rules and VAR gates with citations", async () => {
    // 밀기와 VAR 판정 의존성 구성
    const result = await assessment({
      rule: (id) => ruleSet(id),
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32).fill(1),
    })({ ruleVersionId: "ifab-2025-26", push, variable, observed, options: {} satisfies CompetitionOptions });

    // 평가 성공 확인
    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") return;
    expect(result.value.varAssessment?.category).toBe("GOAL_NO_GOAL");
    expect(result.value.citations.length).toBeGreaterThan(1);
    expect(result.value.factSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an unknown rule version", async () => {
    // 알 수 없는 규정 판본 실행
    await expect(assessment({
      rule: () => null,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({ ruleVersionId: "ifab-missing", push, variable, observed, options: {} })).resolves.toEqual({
      kind: "RULE_VERSION_UNKNOWN",
    });
  });

  it.each([
    ["DIRECT_FREE_KICK", "CAUTION", "MATCH"],
    ["DIRECT_FREE_KICK", null, "UNDETERMINED"],
    ["PLAY_CONTINUED", "NONE", "MISMATCH"],
    ["UNKNOWN", null, "UNDETERMINED"],
  ] as const)("관측 판정 %s 비교", async (restartType, card, match) => {
    // 관측 판정과 규정 결과를 별도 비교
    const operation = assessment({
      rule: (id) => ruleSet(id),
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32).fill(1),
    });
    const input = { ruleVersionId: "ifab-2025-26", push, variable, options: {}, observed: {
      restartType, restartBeneficiary: "DEFENDING_TEAM", card,
      goalDecision: "NOT_APPLICABLE", source: "USER_INPUT",
    } } as Parameters<typeof operation>[0] & { observed: import("@replay/shared-types").ObservedDecision };
    const result = await operation(input);
    expect(result).toMatchObject({ kind: "EVALUATED", value: { decisionMatch: match } });
  });

  it("파울 없음과 카드 없음 관측 일치", async () => {
    // 규정 결과의 null 징계와 관측의 카드 없음은 같은 의미
    const result = await assessment({
      rule: (id) => ruleSet(id), push: pushResult, variable: varResult,
      hash: async () => new Uint8Array(32).fill(1),
    })({ ruleVersionId: "ifab-2025-26", push: { ...push, contactDetected: { ...push.contactDetected, value: false } },
      variable, options: {}, observed: { ...observed, restartType: "PLAY_CONTINUED", card: "NONE" } });
    expect(result).toMatchObject({ kind: "EVALUATED", value: { decisionMatch: "MATCH" } });
  });
});
