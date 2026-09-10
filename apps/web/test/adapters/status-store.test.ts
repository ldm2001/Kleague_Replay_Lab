import { describe, expect, it } from "vitest";
import { StatusStore } from "@replay/adapters";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { judgment } from "../fixtures/result";

const rows = [
  [{
    video_asset_id: "11111111-1111-4111-8111-111111111111",
    video_status: "VALID",
    validation_error_code: null,
    analysis_id: "22222222-2222-4222-8222-222222222222",
    analysis_status: "CANDIDATES_READY",
    pipeline_version: "video-baseline-v1",
    stage: "SUCCEEDED",
    progress_percent: 100,
    failure_code: null,
    limitations: ["incident_category_classification_pending"],
    has_decisions: false,
  }],
  [{
    candidate_index: 1,
    start_ms: 500,
    end_ms: 1500,
    anchor_ms: 1000,
    signal_score: 0.42,
    camera_sufficiency: "MEDIUM",
    reasons: ["motion-spike"],
  }],
  [{
    id: "55555555-5555-4555-8555-555555555555",
    candidate_index: 1,
    kind: "FRAME",
  }],
];

const sceneEvent = {
  kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
  evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};
const statusCommand = {
  anonymousSessionId: "33333333-3333-4333-8333-333333333333",
  videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z",
};

// 상태 저장소 테스트
describe("StatusStore", () => {
  it("returns only two recognized events from 41 stored proposals and preserves raw diagnostics", async () => {
    const candidates = Array.from({ length: 41 }, (_, index) => ({
      ...rows[1]![0], candidate_index: index + 1,
      category: index < 2 ? "CORNER_KICK" : "OTHER",
      scene_event: index < 2 ? sceneEvent : null,
    }));
    const evidence = candidates.map((candidate) => ({ ...rows[2]![0], candidate_index: candidate.candidate_index }));
    const queue = [rows[0], candidates, evidence];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis?.candidates.map((candidate) => candidate.index)).toEqual([1, 2]);
    expect(result?.analysis?.diagnostics).toEqual({
      rawProposalCount: 39, invalidOutputCount: 0, recognizedEventCount: 2,
      supportedEventTypes: ["CORNER_KICK"],
      reasons: ["CORNER_ONLY_DETECTOR", "UNRECOGNIZED_PROPOSALS", "CONTACT_UNOBSERVED",
        "INCIDENT_UNCLASSIFIED", "INTENSITY_UNOBSERVED", "RULE_CONTEXT_UNVERIFIED", "TRACKING_UNAVAILABLE"],
    });
    expect(result?.analysis?.filterSummary).toEqual({
      checkedCount: 41, excludedCount: 0, undeterminedCount: 39, observedCount: 2, applicableCount: 0,
    });
    expect(result?.analysis?.limitations).toEqual(["incident_category_classification_pending"]);
    expect(result?.analysis?.rule).toBeNull();
    expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
  });

  it("keeps a valid recognized corner when legal review is undetermined without evidence", async () => {
    const queue = [rows[0], [{ ...rows[1]![0], category: "CORNER_KICK", scene_event: sceneEvent }], []];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis?.candidates).toHaveLength(1);
    expect(result?.analysis?.candidates[0]).toMatchObject({
      sceneEvent, judgment: null, facts: null, evidence: [],
      filter: { status: "UNDETERMINED", reasonCodes: expect.arrayContaining(["EVIDENCE_UNAVAILABLE"]),
        missingFields: expect.arrayContaining(["sceneEvidence"]), ruleReferences: [] },
    });
    expect(result?.analysis?.diagnostics).toMatchObject({
      rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1, supportedEventTypes: ["CORNER_KICK"],
    });
    expect(result?.analysis?.filterSummary?.undeterminedCount).toBe(1);
  });

  it.each([0, 1])("returns no recognized events and explicit detector limits for %i raw proposals", async (rawCount) => {
    const queue = [rows[0], rawCount === 0 ? [] : rows[1], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis?.candidates).toEqual([]);
    expect(result?.analysis?.diagnostics).toMatchObject({
      rawProposalCount: rawCount, invalidOutputCount: 0, recognizedEventCount: 0,
      supportedEventTypes: ["CORNER_KICK"], reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR"]),
    });
    expect(result?.analysis?.diagnostics?.reasons.includes("UNRECOGNIZED_PROPOSALS")).toBe(rawCount > 0);
    expect(result?.analysis?.limitations).toEqual(["incident_category_classification_pending"]);
    expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
  });

  it.each([
    { changes: { start_ms: -1 }, code: "INVALID_INTERVAL" },
    { changes: { tracking: { version: "invalid" } }, code: "INVALID_TRACKING" },
    { changes: { scene_event: { ...sceneEvent, endMs: 2000 } }, code: "INVALID_SCENE_EVENT" },
  ])("counts $code outputs once, separately from raw proposals and recognized events", async ({ changes, code }) => {
    const candidates = [
      { ...rows[1]![0], category: "CORNER_KICK", scene_event: sceneEvent },
      { ...rows[1]![0], candidate_index: 2, category: "CORNER_KICK" },
      { ...rows[1]![0], candidate_index: 3, scene_event: sceneEvent, ...changes },
    ];
    const queue = [rows[0], candidates, rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis?.candidates.map((candidate) => candidate.index)).toEqual([1]);
    expect(result?.analysis?.diagnostics).toMatchObject({
      rawProposalCount: 1, invalidOutputCount: 1, recognizedEventCount: 1,
      reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR", "UNRECOGNIZED_PROPOSALS", "SCENE_EVENT_UNAVAILABLE", code]),
    });
    const diagnostics = result!.analysis!.diagnostics!;
    expect(diagnostics.rawProposalCount + diagnostics.invalidOutputCount + diagnostics.recognizedEventCount).toBe(candidates.length);
    expect(result?.analysis?.filterSummary).toMatchObject({ checkedCount: 3, excludedCount: 1, undeterminedCount: 1, observedCount: 1 });
  });

  it("does not mark an empty recognized result adjudicated because raw proposals have legacy judgments", async () => {
    const queue = [rows[0], [{
      ...rows[1]![0], fact_revision_id: "44444444-4444-4444-8444-444444444444", fact_source: "USER",
      foul_decision: "NO_FOUL", var_reviewable: false, var_category: "NONE", var_within_time_window: false,
      var_threshold_met: "NOT_MET", var_intervention: "NO_INTERVENTION", var_window_exception: "NONE", var_review_procedure: "NONE",
    }], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis).toMatchObject({
      candidates: [], evaluatedCount: 0, mode: "VISUAL_CHANGE_BASELINE", judgmentStatus: "NOT_EVALUATED",
      diagnostics: { rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 0 },
    });
  });

  it.each([null, undefined])("preserves historical facts, observations and judgments without pipeline version %s", async (pipelineVersion) => {
    const observation = { model: "legacy-model", category: "UNKNOWN", contact: "UNKNOWN", displacement: "uncertain",
      camera: "LOW", summary: "기존 관찰 이력", timestamps: [600, 900, 1400] };
    const shots = [{ id: "66666666-6666-4666-8666-666666666666", index: 0, startMs: 0, endMs: 2000 }];
    const queue = [[{ ...rows[0]![0], pipeline_version: pipelineVersion }], [{
      ...rows[1]![0], fact_revision_id: judgment.factRevisionId, fact_snapshot: judgment.facts, fact_source: judgment.source,
      observation, linked_shots: shots, foul_decision: judgment.decision,
      var_reviewable: judgment.varAssessment.reviewable, var_category: judgment.varAssessment.category,
      var_within_time_window: judgment.varAssessment.withinTimeWindow, var_threshold_met: judgment.varAssessment.thresholdMet,
      var_intervention: judgment.varAssessment.intervention, var_window_exception: judgment.varAssessment.windowException,
      var_review_procedure: judgment.varAssessment.reviewProcedure,
    }], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    const result = await repository.status(statusCommand);

    expect(result?.analysis).toMatchObject({
      evaluatedCount: 1, mode: "ADJUDICATED", judgmentStatus: "EVALUATED",
      candidates: [{ index: 1, sceneEvent: null, factRevisionId: judgment.factRevisionId, facts: judgment.facts,
        observation, shots, judgment: { factRevisionId: judgment.factRevisionId, facts: judgment.facts, source: judgment.source, decision: judgment.decision },
      }],
    });
    expect(result?.analysis).not.toHaveProperty("diagnostics");
  });

  it("returns a stored corner observation and its rules conditions without inventing a match edition", async () => {
    const queue = [rows[0], [{ ...rows[1]![0], scene_event: sceneEvent }], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);
    const result = await repository.status({ anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z" });
    expect(result?.analysis?.candidates[0]).toMatchObject({
      sceneEvent, judgment: null,
      filter: { status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true, ruleReferences: [],
        conditions: expect.arrayContaining([expect.objectContaining({ code: "CORNER_RESTART", status: "UNVERIFIED" })]),
      },
    });
    expect(result?.analysis?.filterSummary).toEqual({
      checkedCount: 1, excludedCount: 0, undeterminedCount: 0, observedCount: 1, applicableCount: 0,
    });
  });
  it("excludes invalid candidates from playback while retaining filter counts", async () => {
    const queue = [rows[0], [{ ...rows[1]![0], start_ms: -1 }], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);
    const result = await repository.status({ anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z" });
    expect(result?.analysis?.candidates).toEqual([]);
    expect(result?.analysis?.filterSummary).toEqual({ checkedCount: 1, excludedCount: 1, undeterminedCount: 0, observedCount: 0, applicableCount: 0 });
  });
  it("selects the stored review scenario rather than a nonexistent category column", async () => {
    const queries: string[] = [];
    const queue = [...rows];
    const repository = new StatusStore({ db: { execute: async (statement: SQL) => {
      queries.push(new PgDialect().sqlToQuery(statement).sql);
      return queue.shift() ?? [];
    } } } as never);
    await repository.status({ anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z" });
    expect(queries[1]).toContain("candidate.review_scenario::text as category");
    expect(queries[1]).not.toContain("candidate.category");
  });
  it("keeps processing completed when no football decision is possible", async () => {
    const queue = [[{ ...rows[0]![0], analysis_status: "COMPLETED" }], ...rows.slice(1)];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);
    const result = await repository.status({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z",
    });
    expect(result?.analysis?.status).toBe("COMPLETED");
    expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
  });
  it("maps an owned media analysis view", async () => {
    const queue = [rows[0], [{ ...rows[1]![0], scene_event: sceneEvent }], rows[2]];
    const repository = new StatusStore({
      db: { execute: async () => queue.shift() ?? [] },
    } as never);

    await expect(repository.status({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111",
      now: "2026-08-30T00:00:00.000Z",
    })).resolves.toMatchObject({
      videoStatus: "VALID",
      analysis: {
        status: "CANDIDATES_READY",
        progressPercent: 100,
        candidates: [{
          index: 1,
          signalScore: 0.42,
          filter: {
            status: "OBSERVED",
            reasonCodes: expect.arrayContaining(["RULE_CONTEXT_UNVERIFIED", "SITUATION_OBSERVED"]),
          },
          evidence: [{ evidenceId: "55555555-5555-4555-8555-555555555555", kind: "FRAME" }],
        }],
      },
    });
  });

  it("maps an owned evidence object", async () => {
    const repository = new StatusStore({
      db: { execute: async () => [{ object_key: "evidence/analysis/job/candidate.mp4", kind: "CLIP" }] },
    } as never);

    await expect(repository.media({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      analysisId: "22222222-2222-4222-8222-222222222222",
      evidenceId: "55555555-5555-4555-8555-555555555555",
      now: "2026-08-31T00:00:00.000Z",
    })).resolves.toEqual({
      objectKey: "evidence/analysis/job/candidate.mp4",
      contentType: "video/mp4",
    });
  });

  it("maps the latest owned video identifier", async () => {
    const repository = new StatusStore({
      db: { execute: async () => [{ id: "11111111-1111-4111-8111-111111111111" }] },
    } as never);

    await expect(repository.latest({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      now: "2026-09-01T00:00:00.000Z",
    })).resolves.toBe("11111111-1111-4111-8111-111111111111");
  });

  it("maps an owned analysis directly for the result page", async () => {
    const queue = [[{ video_asset_id: "11111111-1111-4111-8111-111111111111" }], rows[0],
      [{ ...rows[1]![0], scene_event: sceneEvent }], rows[2]];
    const repository = new StatusStore({ db: { execute: async () => queue.shift() ?? [] } } as never);

    await expect(repository.analysis({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      analysisId: "22222222-2222-4222-8222-222222222222",
      now: "2026-09-03T00:00:00.000Z",
    })).resolves.toMatchObject({
      analysisId: "22222222-2222-4222-8222-222222222222",
      candidates: [{ index: 1 }],
    });
  });
});
