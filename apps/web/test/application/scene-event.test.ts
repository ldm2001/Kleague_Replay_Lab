import { describe, expect, it, vi } from "vitest";
import { result, type AnalysisPayload } from "@replay/application";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";
import { WORKER_PROTOCOL, type SceneEvent } from "@replay/shared-types";

const sceneEvent: SceneEvent = {
  kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
  evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};

function payload(value: unknown): AnalysisPayload {
  return {
    kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [],
    candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000,
      confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [],
      sceneEvent: value as SceneEvent,
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

describe("scene event worker API contract", () => {
  it("preserves a bounded corner observation for storage", async () => {
    const { response, save } = await submit(sceneEvent);
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ payload: payload(sceneEvent) }));
  });

  it.each([undefined, null])("accepts legacy payloads without a scene event: %s", async (value) => {
    const { response, save } = await submit(value);
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledOnce();
  });

  it.each([
    { ...sceneEvent, startMs: 499 },
    { ...sceneEvent, endMs: 1501 },
    { ...sceneEvent, restartMs: 600 },
    { ...sceneEvent, restartMs: 1400 },
    { ...sceneEvent, evidenceTimestampsMs: [600, 600, 1100] },
    { ...sceneEvent, evidenceTimestampsMs: [600, 900] },
    { ...sceneEvent, evidenceTimestampsMs: [1000, 1400] },
    { ...sceneEvent, evidenceTimestampsMs: [600, 1401] },
    { ...sceneEvent, method: "unsupported-detector" },
    { ...sceneEvent, kind: "FREE_KICK" },
  ])("rejects malformed scene evidence before storage: %j", async (value) => {
    const { response, save } = await submit(value);
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
