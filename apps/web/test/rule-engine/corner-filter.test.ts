import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { pipelineFilter } from "@replay/rule-engine";
import { sceneEventData } from "@replay/shared-types";

const event = {
  kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
  startMs: 1000, endMs: 4000, restartMs: 2000, evidenceTimestampsMs: [1000, 1500, 2000, 3000],
};
const candidate = {
  startMs: 0, endMs: 5000, anchorMs: 2000, category: "OTHER",
  evidenceIds: ["corner-frame", "restart-frame"], sceneEvent: event,
};

describe("observed corner through the rules filter", () => {
  it("keeps a video observation and reference topics when the match edition is unknown", () => {
    const result = pipelineFilter(candidate, null);
    expect(result).toMatchObject({ status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true });
    expect(result.reasonCodes).toContain("RULE_CONTEXT_UNVERIFIED");
    expect(result.reasonCodes).toContain("SITUATION_OBSERVED");
    expect(result.reasonCodes).not.toContain("INCIDENT_UNCLASSIFIED");
    expect(result.reasonCodes).not.toContain("CONTACT_UNOBSERVED");
    expect(result.reasonCodes).not.toContain("INTENSITY_UNOBSERVED");
    expect(result.ruleReferences).toEqual([]);
    expect(result.conditions).toHaveLength(4);
    expect(result.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(true);
    expect(result.conditions?.find((condition) => condition.code === "DIRECT_CORNER_OFFSIDE")?.description).toContain("직접");
    expect(result).not.toHaveProperty("decision");
  });

  it.each(["ifab-2025-26", "ifab-2026-27"])("routes a corner to actual Law 17/11 clauses for %s", (versionId) => {
    const result = pipelineFilter(candidate, ruleSet(versionId));
    expect(result).toMatchObject({ status: "APPLICABLE", situation: "CORNER_KICK", referenceOnly: false });
    expect(result.ruleReferences.map((reference) => reference.law)).toEqual(["17", "11"]);
    expect(result.ruleReferences.every((reference) => reference.ruleId.startsWith(versionId))).toBe(true);
    expect(result.ruleReferences.every((reference) => reference.sourcePage && reference.sourceUrl)).toBe(true);
    expect(result.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(true);
    expect(result.conditions?.every((condition) => condition.sourceUrl.includes("downloads.theifab.com"))).toBe(true);
    expect(result).not.toHaveProperty("decision");
  });

  it("does not mistake an unrelated or incomplete rule catalog for corner coverage", () => {
    const rules = ruleSet("ifab-2026-27")!;
    const result = pipelineFilter(candidate, { ...rules, cite: () => [] });
    expect(result).toMatchObject({ status: "OBSERVED", referenceOnly: true, ruleReferences: [] });
    expect(result.reasonCodes).toContain("RULE_CLAUSES_UNAVAILABLE");
  });

  it("does not classify a corner from a category string without timed evidence", () => {
    const result = pipelineFilter({ ...candidate, category: "CORNER_KICK", sceneEvent: null }, null);
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).toContain("SCENE_EVENT_UNAVAILABLE");
    expect(result.situation).toBeUndefined();
  });

  it("does not route an event without playable evidence", () => {
    const result = pipelineFilter({ ...candidate, evidenceIds: [] }, ruleSet("ifab-2026-27"));
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).toContain("EVIDENCE_UNAVAILABLE");
    expect(result.ruleReferences).toEqual([]);
  });

  it.each([
    { ...event, kind: "THROW_IN" },
    { ...event, status: "CONFIRMED" },
    { ...event, method: "manual" },
    { ...event, startMs: -1 },
    { ...event, endMs: 5001 },
    { ...event, restartMs: 1000 },
    { ...event, restartMs: 4000 },
    { ...event, evidenceTimestampsMs: [] },
    { ...event, evidenceTimestampsMs: [1000] },
    { ...event, evidenceTimestampsMs: [999, 3000] },
    { ...event, evidenceTimestampsMs: [1000, 4001] },
    { ...event, evidenceTimestampsMs: [1000, 1000, 3000] },
    { ...event, evidenceTimestampsMs: [1000, 1999] },
    { ...event, evidenceTimestampsMs: [2000, 3000] },
    { ...event, evidenceTimestampsMs: [1000, Number.NaN] },
    { ...event, evidenceTimestampsMs: [1000, 2000.5] },
    { ...event, evidenceTimestampsMs: Array.from({ length: 257 }, (_, index) => 1000 + index * 10) },
  ])("rejects malformed or out-of-window scene observations", (sceneEvent) => {
    expect(sceneEventData(sceneEvent, 0, 5000)).toBe(false);
    expect(pipelineFilter({ ...candidate, sceneEvent }, null)).toMatchObject({
      status: "EXCLUDED", reasonCodes: ["INVALID_SCENE_EVENT"], ruleReferences: [],
    });
  });

  it("keeps the old OTHER path unchanged when there is no observation", () => {
    const result = pipelineFilter({ ...candidate, sceneEvent: undefined }, null);
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["INCIDENT_UNCLASSIFIED", "CONTACT_UNOBSERVED", "INTENSITY_UNOBSERVED"]));
  });
});
