import { describe, expect, it } from "vitest";
import * as engine from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";

const candidate = {
  startMs: 0, endMs: 2000, anchorMs: 1000,
  evidenceIds: ["frame-1"], category: "OTHER", signalScore: 1,
};

describe("pipeline rule filter", () => {
  it("never turns a visual change score into contact or a foul", () => {
    const result = engine.pipelineFilter(candidate, null);
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).toContain("RULE_CONTEXT_UNVERIFIED");
    expect(result.reasonCodes).toContain("INCIDENT_UNCLASSIFIED");
    expect(result.missingFields).toEqual(expect.arrayContaining(["contact", "intensity"]));
    expect(result.ruleReferences).toEqual([]);
    expect(result).not.toHaveProperty("decision");
  });

  it("checks requirements even when a verified rule set is available", () => {
    const result = engine.pipelineFilter(candidate, ruleSet("ifab-2026-27"));
    expect(result.status).toBe("UNDETERMINED");
    expect(result.reasonCodes).not.toContain("RULE_CONTEXT_UNVERIFIED");
    expect(result.reasonCodes).toContain("CONTACT_UNOBSERVED");
    expect(result.ruleReferences.length).toBeGreaterThan(0);
    expect(result.evidenceIds).toEqual(["frame-1"]);
  });

  it.each([
    { ...candidate, startMs: -1 },
    { ...candidate, endMs: 0 },
    { ...candidate, anchorMs: 3000 },
    { ...candidate, startMs: Number.NaN },
  ])("excludes invalid timeline metadata without a football decision", (value) => {
    expect(engine.pipelineFilter(value, null)).toMatchObject({
      status: "EXCLUDED", reasonCodes: ["INVALID_INTERVAL"], ruleReferences: [],
    });
  });

  it("keeps a valid candidate with unavailable evidence as undetermined", () => {
    expect(engine.pipelineFilter({ ...candidate, evidenceIds: [] }, null)).toMatchObject({
      status: "UNDETERMINED", reasonCodes: expect.arrayContaining(["EVIDENCE_UNAVAILABLE"]),
    });
  });
});
