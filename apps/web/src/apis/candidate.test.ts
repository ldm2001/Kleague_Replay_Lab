import { describe, expect, it } from "vitest";
import { decision, facts, type EvaluationApiDependencies } from "./candidate";

const session = { sessionId: "11111111-1111-4111-8111-111111111111" };
const analysisId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";

const dependencies = (): EvaluationApiDependencies => ({
  resolve: async () => session,
  facts: async () => ({ kind: "CREATED", factRevisionId: candidateId, revision: 1 }),
  decision: async () => ({ kind: "CREATED", decisionId: candidateId }),
});

describe("candidate API", () => {
  it("rejects an unscoped facts request", async () => {
    const response = await facts(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({}) }),
      { analysisId, candidateId },
      { ...dependencies(), resolve: async () => null },
    );
    expect(response.status).toBe(401);
  });

  it("passes a scoped fact patch to the use case", async () => {
    const response = await facts(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ idempotencyKey: "fact-1", facts: {} }),
        headers: { cookie: "replay_session=session-token" },
      }),
      { analysisId, candidateId },
      dependencies(),
    );
    expect(response.status).toBe(201);
  });

  it("returns the saved decision", async () => {
    const response = await decision(
      new Request("http://localhost", { headers: { cookie: "replay_session=session-token" } }),
      { analysisId, candidateId },
      dependencies(),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ kind: "CREATED", decisionId: candidateId });
  });
});
