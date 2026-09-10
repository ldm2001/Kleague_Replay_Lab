import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { pipelineFilter } from "@replay/rule-engine";
import { trackingData } from "@replay/shared-types";

const scene = { startMs: 0, endMs: 2000, anchorMs: 1000, category: "OTHER", evidenceIds: ["frame"] };
const tracking = { version: "ball-path-v1", coverage: "COMPLETE", sampleCount: 30, selectedCount: 20, cameraCount: 18, motionOnsetsMs: [1000] };

describe("tracking through the rules filter", () => {
  it("valid motion evidence still cannot establish contact or a foul", () => {
    expect(trackingData(tracking, 0, 2000)).toBe(true);
    const result = pipelineFilter({ ...scene, tracking }, ruleSet("ifab-2026-27"));
    expect(result.trackingStatus).toBe("MOTION_ONSET");
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["CONTACT_UNOBSERVED", "INTENSITY_UNOBSERVED", "INCIDENT_UNCLASSIFIED"]));
    expect(result.ruleReferences.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("decision");
  });

  it.each([
    [null, "UNAVAILABLE", "TRACKING_UNAVAILABLE"],
    [{ ...tracking, coverage: "PARTIAL" }, "PARTIAL", "TRACKING_INCOMPLETE"],
    [{ ...tracking, cameraCount: 0, motionOnsetsMs: [] }, "POSITION_ONLY", "CAMERA_MOTION_UNVERIFIED"],
    [{ ...tracking, selectedCount: 0, cameraCount: 0, motionOnsetsMs: [] }, "UNAVAILABLE", "TRACKING_UNAVAILABLE"],
  ])("preserves incomplete or unavailable evidence", (value, state, reason) => {
    const result = pipelineFilter({ ...scene, tracking: value }, null);
    expect(result.status).toBe("UNDETERMINED");
    expect(result.trackingStatus).toBe(state);
    expect(result.reasonCodes).toContain(reason);
  });

  it.each([
    { ...tracking, cameraCount: 21 },
    { ...tracking, selectedCount: 31 },
    { ...tracking, sampleCount: -1 },
    { ...tracking, motionOnsetsMs: [2001] },
    { ...tracking, motionOnsetsMs: [1000, 1000] },
    { ...tracking, cameraCount: 1 },
    { ...tracking, version: "unknown" },
  ])("excludes malformed measurements", (value) => {
    expect(trackingData(value, 0, 2000)).toBe(false);
    expect(pipelineFilter({ ...scene, tracking: value }, null)).toMatchObject({ status: "EXCLUDED", reasonCodes: ["INVALID_TRACKING"] });
  });
});
