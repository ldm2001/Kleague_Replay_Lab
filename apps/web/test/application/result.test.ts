// 결과 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
  report,
  type AnalysisResultCommand,
  type AnalysisResultStore,
  type AnalysisView,
} from "@replay/application";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-03T00:00:00.000Z");

const view = {
  analysisId: ANALYSIS,
  mode: "VISUAL_CHANGE_BASELINE",
  judgmentStatus: "NOT_EVALUATED",
  status: "CANDIDATES_READY",
  stage: "SUCCEEDED",
  progressPercent: 100,
  failureCode: null,
  limitations: [],
  candidates: [],
} satisfies AnalysisView;

class ResultDouble implements AnalysisResultStore {
  commands: AnalysisResultCommand[] = [];

  async analysis(command: AnalysisResultCommand) {
    this.commands.push(command);
    return view;
  }
}

describe("analysis result", () => {
  it("loads only an analysis owned by the active anonymous session", async () => {
    const repository = new ResultDouble();
    const value = await report({ clock: { now: () => NOW }, repository })({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
    });

    expect(value).toEqual(view);
    expect(repository.commands).toEqual([{ anonymousSessionId: SESSION, analysisId: ANALYSIS, now: NOW.toISOString() }]);
  });

  it("rejects malformed identifiers before the repository", async () => {
    const repository = new ResultDouble();
    await expect(report({ clock: { now: () => NOW }, repository })({ anonymousSessionId: SESSION, analysisId: "bad" })).resolves.toEqual({ kind: "INVALID_INPUT" });
    expect(repository.commands).toHaveLength(0);
  });
});
