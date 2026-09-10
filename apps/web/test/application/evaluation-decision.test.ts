import { describe, expect, it } from "vitest";
import { assessment, decision, type DecisionSaveCommand, type EvaluationContext, type EvaluationStore } from "@replay/application";
import { combineCompetitionRules, ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { observation, type EvaluationFacts } from "@replay/shared-types";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const FACT = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-03T00:00:00.000Z");
const facts: EvaluationFacts = {
  push: {
    contactDetected: observation(true, "NORMAL", []),
    severity: observation("RECKLESS", "NORMAL", []),
    opponentDisplacement: observation("clear", "NORMAL", []),
    insidePenaltyArea: observation(true, "NORMAL", []),
    cameraSufficiency: "HIGH",
  },
  variable: {
    reviewScenario: "PENALTY_NOT_GIVEN", restartOccurred: false,
    sendOffCategory: "NONE", mistakenIdentity: false, decisionNature: "SUBJECTIVE",
    errorMagnitude: "CLEAR_AND_OBVIOUS", seriousMissedIncident: false,
  },
  observed: {
    restartType: "PLAY_CONTINUED", restartBeneficiary: "NONE", card: null,
    goalDecision: "NOT_APPLICABLE", source: "USER_INPUT",
  },
};

const run = assessment({
  rule: ruleSet, competitionRule: combineCompetitionRules, push: pushResult, variable: varResult,
  hash: async () => new Uint8Array(32),
});

const execute = async (competition?: EvaluationContext["competition"]) => {
  const saved: DecisionSaveCommand[] = [];
  const context: EvaluationContext = {
    analysisId: ANALYSIS, analysisStateVersion: 1, candidateId: CANDIDATE, factRevisionId: FACT,
    facts, ruleVersionId: "ifab-2025-26", ruleVersionDbId: VERSION, competitionOptions: {},
    ...(competition ? { competition } : {}),
  };
  const repository: EvaluationStore = {
    patch: async () => ({ kind: "NOT_FOUND" }),
    context: async () => ({ kind: "READY", value: context }),
    save: async (command) => {
      saved.push(command);
      return { kind: "CREATED", decisionId: CANDIDATE };
    },
  };
  const result = await decision({ clock: { now: () => NOW }, repository, run })({
    anonymousSessionId: SESSION, analysisId: ANALYSIS, candidateId: CANDIDATE,
  });
  return { result, saved };
};

describe("decision competition context", () => {
  it("uses a new engine version for competition-composed evaluations", async () => {
    const { saved } = await execute({ competition: "K리그1", season: "2026" });

    expect(saved[0]?.ruleEngineVersion).toBe("rule-engine-v2-competition");
  });

  it.each([
    ["K리그1", "2025", "kleague1-2025"],
    ["K리그2", "2025", "kleague2-2025"],
    ["K리그1", "2026", "kleague1-2026"],
    ["K리그2", "2026", "kleague2-2026"],
  ])("forwards the bound %s %s rule book to assessment", async (competition, season, versionId) => {
    const { result, saved } = await execute({ competition, season });

    expect(result.kind).toBe("CREATED");
    expect(saved).toHaveLength(1);
    const citations = saved[0]!.evaluation.citations.filter((item) => item.authority === "KLEAGUE");
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === season)).toBe(true);
  });

  it.each([
    ["unknown", "2026"],
    ["K리그1", "2024"],
  ])("does not save an evaluation without matching %s %s rule data", async (competition, season) => {
    const { result, saved } = await execute({ competition, season });

    expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
    expect(saved).toHaveLength(0);
  });

  it("preserves standalone IFAB evaluation without competition context", async () => {
    const { result, saved } = await execute();

    expect(result.kind).toBe("CREATED");
    expect(saved[0]!.evaluation.citations.every((item) => item.authority === "IFAB")).toBe(true);
  });
});
