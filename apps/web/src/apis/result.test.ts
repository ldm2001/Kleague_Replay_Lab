import { describe, expect, it } from "vitest";
import { analysis, type ResultApiDependencies } from "./result";

const ANALYSIS = "22222222-2222-4222-8222-222222222222";

const dependencies = (): ResultApiDependencies => ({
  resolve: async () => ({ sessionId: "11111111-1111-4111-8111-111111111111" }),
  report: async () => ({
    analysisId: ANALYSIS,
    mode: "VISUAL_CHANGE_BASELINE",
    judgmentStatus: "NOT_EVALUATED",
    status: "CANDIDATES_READY",
    stage: "SUCCEEDED",
    progressPercent: 100,
    failureCode: null,
    limitations: [],
    candidates: [],
  }),
});

describe("result API", () => {
  it("returns an analysis scoped by the anonymous session", async () => {
    const response = await analysis(
      new Request("http://localhost", { headers: { cookie: "replay_session=session-token" } }),
      { analysisId: ANALYSIS },
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ analysisId: ANALYSIS });
  });

  it("rejects a request without an active session", async () => {
    const response = await analysis(
      new Request("http://localhost"),
      { analysisId: ANALYSIS },
      { ...dependencies(), resolve: async () => null },
    );
    expect(response.status).toBe(401);
  });
});
