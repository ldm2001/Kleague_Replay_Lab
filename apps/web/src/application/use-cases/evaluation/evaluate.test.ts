import { describe, expect, it } from "vitest";
import type { CompetitionOptions, PushFacts, VarFacts } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { evaluate } from "./evaluate.js";

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

describe("evaluate", () => {
  it("combines pushing rules and VAR gates with citations", async () => {
    const result = await evaluate({
      rule: (id) => ruleSet(id),
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32).fill(1),
    })({ ruleVersionId: "ifab-2025-26", push, variable, options: {} satisfies CompetitionOptions });

    expect(result.kind).toBe("EVALUATED");
    if (result.kind !== "EVALUATED") return;
    expect(result.value.varAssessment?.category).toBe("GOAL_NO_GOAL");
    expect(result.value.citations.length).toBeGreaterThan(1);
    expect(result.value.factSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an unknown rule version", async () => {
    await expect(evaluate({
      rule: () => null,
      push: pushResult,
      variable: varResult,
      hash: async () => new Uint8Array(32),
    })({ ruleVersionId: "ifab-missing", push, variable, options: {} })).resolves.toEqual({
      kind: "RULE_VERSION_UNKNOWN",
    });
  });
});
