import { describe, expect, it, vi } from "vitest";
import { result, type AnalysisPayload } from "@replay/application";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";
import { WORKER_PROTOCOL, type BroadcastCue } from "@replay/shared-types";

const broadcastCue: BroadcastCue = {
  kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 600, endMs: 1400,
  evidenceTimestampsMs: [600, 1000, 1400],
};

function payload(value: unknown): AnalysisPayload {
  return {
    kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [],
    candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000,
      confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [],
      ...{ broadcastCue: value as BroadcastCue },
    }],
  };
}

async function submit(value: unknown) {
  const save = vi.fn(async () => ({ kind: "ACCEPTED" as const }));
  const operation = result({
    clock: { now: () => new Date("2030-01-01T12:00:00.000Z") },
    hasher: { sha256: async () => new Uint8Array([1, 2, 3]) },
    repository: { result: save },
  });
  const response = await acceptResult(new Request("http://local/internal/jobs/result", {
    method: "POST", headers: { "content-type": "application/json", "x-worker-key": "test-key", "x-worker-protocol": WORKER_PROTOCOL },
    body: JSON.stringify({ workerId: "test-worker", jobRevision: 1, leaseToken: "test-lease", payload: payload(value) }),
  }), { jobId: "11111111-1111-4111-8111-111111111111" }, { key: "test-key", result: operation } as JobApiDependencies);
  return { response, save };
}

describe("broadcast cue worker API contract", () => {
  it("preserves bounded broadcast evidence without converting it into a decision", async () => {
    const { response, save } = await submit(broadcastCue);
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ payload: payload(broadcastCue) }));
  });

  it.each([undefined, null])("accepts legacy payloads without a broadcast cue: %s", async (value) => {
    const { response, save } = await submit(value);
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledOnce();
  });

  it.each([
    { ...broadcastCue, startMs: 499 },
    { ...broadcastCue, endMs: 1501 },
    { ...broadcastCue, endMs: 600 },
    { ...broadcastCue, evidenceTimestampsMs: [600, 899] },
    { ...broadcastCue, evidenceTimestampsMs: [600, 600, 1400] },
    { ...broadcastCue, evidenceTimestampsMs: [600, 1400, 1000] },
    { ...broadcastCue, evidenceTimestampsMs: [601, 1400] },
    { ...broadcastCue, evidenceTimestampsMs: [600, 1401] },
    { ...broadcastCue, evidenceTimestampsMs: [600] },
    { ...broadcastCue, method: "unsupported-detector" },
    { ...broadcastCue, kind: "GOAL_CONFIRMED" },
  ])("rejects malformed broadcast evidence before storage: %j", async (value) => {
    const { response, save } = await submit(value);
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
