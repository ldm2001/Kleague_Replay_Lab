import { describe, expect, it } from "vitest";
import { broadcastCueData } from "../../src/shared/var-scope";

const cue = { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000,
  endMs: 1401, evidenceTimestampsMs: [1000, 1200, 1400] };

describe("broadcast cue contract", () => {
  it("accepts a supported observed graphic with bounded real times", () => {
    expect(broadcastCueData(cue, 0, 2000)).toBe(true);
  });
  it.each([
    { kind: "GOAL_AWARDED" }, { method: "model-caption" }, { startMs: -1 }, { endMs: 3000 },
    { endMs: 1000 }, { evidenceTimestampsMs: [1200] }, { evidenceTimestampsMs: [1400, 1200] },
    { evidenceTimestampsMs: [1000, 1000] }, { evidenceTimestampsMs: [999, 1200] },
    { evidenceTimestampsMs: [1000, 1402] }, { evidenceTimestampsMs: [1000, 1000.5] },
  ])("rejects unsupported or inconsistent cue %j", (changes) => {
    expect(broadcastCueData({ ...cue, ...changes }, 0, 2000)).toBe(false);
  });
});
