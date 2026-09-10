// 평가 엔진 테스트
import { describe, expect, it } from "vitest";
import type { CompetitionOptions, PushFacts, VarFacts } from "@replay/shared-types";
import { combineCompetitionRules, ruleSet } from "@replay/rule-data";
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
    ["K리그1", "2025", "kleague1-2025"],
    ["K리그2", "2025", "kleague2-2025"],
    ["K리그1", "2026", "kleague1-2026"],
    ["K리그2", "2026", "kleague2-2026"],
  ])("evaluates with the selected %s %s rule book", async (competition, season, versionId) => {
    const result = await assessment({
      rule: ruleSet,
      competitionRule: combineCompetitionRules,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({
      ruleVersionId: "ifab-2025-26", competition: { competition, season },
      push, variable, observed, options: {},
    });

    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") return;
    const leagueCitations = result.value.citations.filter((item) => item.authority === "KLEAGUE");
    expect(leagueCitations.length).toBeGreaterThan(0);
    expect(leagueCitations.every((item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === season)).toBe(true);
    expect(result.value.citations.some((item) => item.authority === "IFAB" && item.edition === "2025-26")).toBe(true);
  });

  it.each([
    ["unknown", "2026"],
    ["K리그1", "2024"],
    ["K리그2", "2027"],
  ])("rejects unavailable competition data for %s %s", async (competition, season) => {
    const result = await assessment({
      rule: ruleSet,
      competitionRule: combineCompetitionRules,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({
      ruleVersionId: "ifab-2025-26", competition: { competition, season },
      push, variable, observed, options: {},
    });

    expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
  });

  it("does not silently ignore competition when its resolver is unavailable", async () => {
    const result = await assessment({
      rule: ruleSet,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({
      ruleVersionId: "ifab-2025-26", competition: { competition: "K리그1", season: "2026" },
      push, variable, observed, options: {},
    });

    expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
  });

  it("applies the K League scope before evaluating the IFAB corner option", async () => {
    const result = await assessment({
      rule: ruleSet,
      competitionRule: combineCompetitionRules,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({
      ruleVersionId: "ifab-2026-27", competition: { competition: "K리그2", season: "2026" },
      push, variable: { ...variable, reviewScenario: "CORNER_KICK_AWARDED" }, observed, options: {},
    });

    expect(result).toMatchObject({ kind: "EVALUATED", value: { varAssessment: {
      reviewable: false, notReviewableReason: "OUTSIDE_REVIEWABLE_CATEGORIES", intervention: "NO_INTERVENTION",
    } } });
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
