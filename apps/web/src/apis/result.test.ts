import { describe, expect, it } from "vitest";
import { analysis, type ResultApiDependencies } from "./result";

const ANALYSIS = "22222222-2222-4222-8222-222222222222";

// 결과 API 의존성 모형
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

// 분석 결과 API 테스트
describe("result API", () => {
  it("returns an analysis scoped by the anonymous session", async () => {
    // 세션 있는 결과 요청 구성
    const response = await analysis(
      new Request("http://localhost", { headers: { cookie: "replay_session=session-token" } }),
      { analysisId: ANALYSIS },
      dependencies(),
    );
    // 결과 응답 확인
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ analysisId: ANALYSIS });
  });

  it("rejects a request without an active session", async () => {
    // 세션 없는 결과 요청 구성
    const response = await analysis(
      new Request("http://localhost"),
      { analysisId: ANALYSIS },
      { ...dependencies(), resolve: async () => null },
    );
    expect(response.status).toBe(401);
  });
});
