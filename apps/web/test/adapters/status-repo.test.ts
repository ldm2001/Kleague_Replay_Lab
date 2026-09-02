import { describe, expect, it } from "vitest";
import { StatusRepo } from "@replay/adapters";

const rows = [
  [{
    video_asset_id: "11111111-1111-4111-8111-111111111111",
    video_status: "VALID",
    validation_error_code: null,
    analysis_id: "22222222-2222-4222-8222-222222222222",
    analysis_status: "COMPLETED",
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

describe("StatusRepo", () => {
  it("maps an owned media analysis view", async () => {
    const queue = [...rows];
    const repository = new StatusRepo({
      db: { execute: async () => queue.shift() ?? [] },
    } as never);

    await expect(repository.status({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111",
      now: "2026-08-30T00:00:00.000Z",
    })).resolves.toMatchObject({
      videoStatus: "VALID",
      analysis: {
        status: "COMPLETED",
        progressPercent: 100,
        candidates: [{
          index: 1,
          signalScore: 0.42,
          evidence: [{ evidenceId: "55555555-5555-4555-8555-555555555555", kind: "FRAME" }],
        }],
      },
    });
  });

  it("maps an owned evidence object", async () => {
    const repository = new StatusRepo({
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
    const repository = new StatusRepo({
      db: { execute: async () => [{ id: "11111111-1111-4111-8111-111111111111" }] },
    } as never);

    await expect(repository.latest({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      now: "2026-09-01T00:00:00.000Z",
    })).resolves.toBe("11111111-1111-4111-8111-111111111111");
  });
});
