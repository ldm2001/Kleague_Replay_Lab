import { describe, expect, it } from "vitest";
import { result, type AnalysisPayload, type JobResultCommand } from "@replay/application";
import { schema } from "@replay/database";

describe("unclassified shot contract", () => {
  it.each([null, false, true])("preserves replay state %s through result validation", async (isReplay) => {
    const commands: JobResultCommand[] = [];
    const payload: AnalysisPayload = {
      kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: ["replay_detection_pending"], candidates: [],
      shots: [{ index: 0, startMs: 0, endMs: 1000, playbackSpeed: "UNKNOWN", isReplay, cameraAngle: null }],
    };
    const operation = result({
      clock: { now: () => new Date("2026-09-21T00:00:00Z") }, hasher: { sha256: async () => new Uint8Array(32) },
      repository: { result: async (command) => { commands.push(command); return { kind: "ACCEPTED" }; } },
    });
    expect(await operation({
      jobId: "11111111-1111-4111-8111-111111111111", workerId: "test-worker", jobRevision: 1, leaseToken: "lease", payload,
    })).toEqual({ kind: "ACCEPTED" });
    expect(commands[0]?.payload).toEqual(payload);
  });

  it("represents unknown replay in the database schema", () => {
    expect(schema.shots.isReplay.notNull).toBe(false);
  });
});
