import { describe, expect, it } from "vitest";
import { facts, type Clock, type EvaluationRepo, type Hasher } from "@replay/application";
import { observation, type EvaluationFacts } from "@replay/shared-types";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-03T00:00:00.000Z");

const value: EvaluationFacts = {
  push: {
    contactDetected: observation(true, "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
    severity: observation("RECKLESS", "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
    opponentDisplacement: observation("clear", "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
    insidePenaltyArea: observation(false, "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
    cameraSufficiency: "HIGH",
  },
  variable: {
    reviewScenario: "PENALTY_NOT_GIVEN",
    restartOccurred: false,
    sendOffCategory: "NONE",
    mistakenIdentity: false,
    decisionNature: "SUBJECTIVE",
    errorMagnitude: "UNDETERMINED",
    seriousMissedIncident: false,
  },
  observed: {
    restartType: "PLAY_CONTINUED",
    restartBeneficiary: "NONE",
    card: null,
    goalDecision: "NOT_APPLICABLE",
    source: "USER_INPUT",
  },
};

class HashFake implements Hasher {
  async sha256(input: string) {
    return new TextEncoder().encode(input).slice(0, 8);
  }
}

class RepoFake implements EvaluationRepo {
  calls: unknown[] = [];
  async patch(input: Parameters<EvaluationRepo["patch"]>[0]) {
    this.calls.push(input);
    return { kind: "CREATED" as const, factRevisionId: CANDIDATE, revision: 1 };
  }
  async context() { return { kind: "NO_FACTS" as const }; }
  async save() { return { kind: "NOT_FOUND" as const }; }
}

const clock: Clock = { now: () => NOW };

describe("facts", () => {
  it("keeps valid observed facts in a user revision command", async () => {
    const repository = new RepoFake();
    const result = await facts({ clock, hasher: new HashFake(), repository })({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
      candidateId: CANDIDATE,
      idempotencyKey: "fact-1",
      facts: value,
    });

    expect(result).toEqual({ kind: "CREATED", factRevisionId: CANDIDATE, revision: 1 });
    expect(repository.calls[0]).toMatchObject({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
      candidateId: CANDIDATE,
      expectedFactRevisionId: null,
      facts: value,
    });
  });

  it("rejects facts that are outside the shared vocabulary", async () => {
    const repository = new RepoFake();
    const result = await facts({ clock, hasher: new HashFake(), repository })({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
      candidateId: CANDIDATE,
      idempotencyKey: "fact-1",
      facts: { ...value, variable: { ...value.variable, reviewScenario: "FOUL" } },
    });

    expect(result).toEqual({ kind: "INVALID_INPUT", reason: "FACTS" });
    expect(repository.calls).toHaveLength(0);
  });

  it("rejects a non string expected fact revision", async () => {
    const repository = new RepoFake();
    const result = await facts({ clock, hasher: new HashFake(), repository })({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
      candidateId: CANDIDATE,
      expectedFactRevisionId: 7 as never,
      idempotencyKey: "fact-1",
      facts: value,
    });

    expect(result).toEqual({ kind: "INVALID_INPUT", reason: "ID" });
    expect(repository.calls).toHaveLength(0);
  });
});
