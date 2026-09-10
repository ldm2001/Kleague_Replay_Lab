// 결과 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
  report,
  type AnalysisResultCommand,
  type AnalysisResultStore,
  type AnalysisView,
} from "@replay/application";
import { analysis as fixture } from "../fixtures/result";
import { competitionRules } from "@replay/rule-data";
import { evaluateVarScope } from "@replay/rule-engine";
import { knownVideoSource } from "../../src/adapters/known-video-sources";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-03T00:00:00.000Z");

// 결과 화면 모형
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
  it("publishes a completed competition-scope answer without inventing a foul judgment", async () => {
    const base = fixture();
    const candidate = base.candidates[0]!;
    const cue = { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000,
      endMs: 1400, evidenceTimestampsMs: [1000, 1200, 1400] } as const;
    const source = knownVideoSource("2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857")!;
    const scope = evaluateVarScope({ broadcastCue: cue, startMs: 0, endMs: 2000, source,
      evidence: candidate.evidence!.map((item) => ({ ...item, startMs: 0, endMs: 2000 })) }, competitionRules("K리그2", "2026"))!;
    const completed = { ...candidate, broadcastCue: cue, varScopeEvaluation: scope, judgment: null };
    const internal: AnalysisView = { ...base, candidates: [completed, base.candidates[1]!],
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 0, recognizedEventCount: 2, supportedEventTypes: ["GOAL_GRAPHIC"], reasons: [] },
    };
    const operation = report({ clock: { now: () => NOW }, repository: { analysis: async () => internal } });
    const value = await operation({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
    expect(value).toMatchObject({ resultPolicy: "COMPLETED_ONLY", completedScopeCount: 1, evaluatedCount: 0,
      judgmentStatus: "NOT_EVALUATED", candidates: [{ varScopeEvaluation: scope, judgment: null }] });
    expect(value && !("kind" in value) && value.candidates).toHaveLength(1);
    expect(value).toHaveProperty("rule", null);
    expect(internal.candidates).toHaveLength(2);

    for (const legacySource of ["MODEL", "USER", "CURATOR"] as const) {
      const old = base.candidates.find((item) => item.judgment)!.judgment!;
      const mixed = { ...completed, facts: old.facts, factRevisionId: old.factRevisionId,
        judgment: { ...old, source: legacySource },
        observation: { model: "legacy-only", category: "UNKNOWN", contact: "UNKNOWN", displacement: "uncertain",
          camera: "LOW", summary: "과거 관찰", timestamps: [1000] } };
      const published = await report({ clock: { now: () => NOW }, repository: {
        analysis: async () => ({ ...internal, candidates: [mixed] } as AnalysisView),
      } })({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
      if (!published || "kind" in published) throw new Error("missing-scope-report");
      expect(published.candidates).toHaveLength(1);
      expect(published.candidates[0]?.judgment).toBeNull();
      expect(published.candidates[0]).not.toHaveProperty("facts");
      expect(published.candidates[0]).not.toHaveProperty("observation");
      expect(published.candidates[0]).not.toHaveProperty("factRevisionId");
    }

    for (const changed of [
      { ...completed, broadcastCue: null },
      { ...completed, evidence: [] },
      { ...completed, varScopeEvaluation: { ...scope, status: "OBSERVED" } },
      { ...completed, varScopeEvaluation: { ...scope, provenance: { ...scope.provenance, origin: "MODEL" } } },
      { ...completed, varScopeEvaluation: { ...scope, provenance: { ...scope.provenance, cueStartMs: 999 } } },
    ]) {
      const result = await report({ clock: { now: () => NOW }, repository: { analysis: async () => ({ ...internal, candidates: [changed] } as AnalysisView) } })({
        anonymousSessionId: SESSION, analysisId: ANALYSIS,
      });
      expect(result).toMatchObject({ candidates: [], completedScopeCount: 0 });
    }
  });

  it("publishes no unfinished automatic results and keeps diagnostics internal", async () => {
    const internal: AnalysisView = {
      ...fixture(),
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 0, recognizedEventCount: 2,
        supportedEventTypes: ["CORNER_KICK"], reasons: ["UNRECOGNIZED_PROPOSALS"] },
      filterSummary: { checkedCount: 41, excludedCount: 0, undeterminedCount: 39, observedCount: 2, applicableCount: 0 },
    };
    const original = structuredClone(internal);
    const value = await report({ clock: { now: () => NOW }, repository: { analysis: async () => internal } })({
      anonymousSessionId: SESSION, analysisId: ANALYSIS,
    });
    expect(value).toMatchObject({ resultPolicy: "COMPLETED_ONLY", candidates: [], evaluatedCount: 0,
      mode: "VISUAL_CHANGE_BASELINE", judgmentStatus: "NOT_EVALUATED" });
    expect(value).not.toHaveProperty("diagnostics");
    expect(value).not.toHaveProperty("filterSummary");
    expect(internal).toEqual(original);
  });

  it.each(["MODEL", "USER", "CURATOR"] as const)("does not reuse a %s judgment as a completed automatic evaluation", async (source) => {
    const previous = fixture();
    const candidate = previous.candidates.find((item) => item.judgment)!;
    const internal: AnalysisView = { ...previous,
      mode: "ADJUDICATED", judgmentStatus: "EVALUATED", evaluatedCount: 1,
      candidates: [{ ...candidate, judgment: { ...candidate.judgment!, source } }],
      diagnostics: { rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1,
        supportedEventTypes: ["CORNER_KICK"], reasons: [] },
    };
    const value = await report({ clock: { now: () => NOW }, repository: { analysis: async () => internal } })({
      anonymousSessionId: SESSION, analysisId: ANALYSIS,
    });
    expect(value).toMatchObject({ resultPolicy: "COMPLETED_ONLY", candidates: [], evaluatedCount: 0, judgmentStatus: "NOT_EVALUATED" });
  });

  it("keeps a missing analysis missing", async () => {
    expect(await report({ clock: { now: () => NOW }, repository: { analysis: async () => null } })({
      anonymousSessionId: SESSION, analysisId: ANALYSIS,
    })).toBeNull();
  });

  it("loads only an analysis owned by the active anonymous session", async () => {
    // 소유 분석 조회 실행
    const repository = new ResultDouble();
    const value = await report({ clock: { now: () => NOW }, repository })({
      anonymousSessionId: SESSION,
      analysisId: ANALYSIS,
    });

    expect(value).toEqual(view);
    expect(repository.commands).toEqual([{ anonymousSessionId: SESSION, analysisId: ANALYSIS, now: NOW.toISOString() }]);
  });

  it("rejects malformed identifiers before the repository", async () => {
    // 잘못된 식별자 조회 실행
    const repository = new ResultDouble();
    await expect(report({ clock: { now: () => NOW }, repository })({ anonymousSessionId: SESSION, analysisId: "bad" })).resolves.toEqual({ kind: "INVALID_INPUT" });
    expect(repository.commands).toHaveLength(0);
  });
});
