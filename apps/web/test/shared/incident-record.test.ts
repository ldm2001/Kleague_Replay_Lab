import { describe, expect, it } from "vitest";
import { incidentRecordData } from "../../src/shared/incident-validation";
import { incidentAssertion, incidentFixture } from "../fixtures/incident-record";
import { INCIDENT_OBSERVATION_KEYS } from "../../src/shared/incident-record";

describe("incident-record-v1 structural contract", () => {
  it("names referee-response context after observed actions, not established offences", () => {
    const r = incidentFixture();
    expect(r.actions[0]!.context).toHaveProperty("stoppedForThisAction");
    expect(r.actions[0]!.context).toHaveProperty("otherActionInRestartSequence");
    expect(r.actions[0]!.context).not.toHaveProperty("stoppedForThisOffence");
    expect(r.actions[0]!.context).not.toHaveProperty("competingOffenceAffectsRestart");
  });
  it("accepts producer claims without promoting model confidence to rule facts", () => {
    expect(incidentRecordData(incidentFixture())).toBe(true);
  });
  it.each([
    ["unknown root key", (r: any) => { r.severity = "CARELESS"; }],
    ["normative raw observation", (r: any) => { r.actions[0].observations.careless = r.actions[0].observations.actionObserved; }],
    ["missing proof", (r: any) => { r.actions[0].observations.actionObserved.evidenceIds = []; }],
    ["missing uncertainty reason", (r: any) => { r.actions[0].observations.pulling.reasons = []; }],
    ["dangling evidence", (r: any) => { r.actions[0].observations.actionObserved.evidenceIds = ["missing"]; }],
    ["duplicate assertion id", (r: any) => { r.actions[0].observations.actionObserved.id = r.actors[0].teamAssignment.id; }],
    ["outside segment", (r: any) => { r.actions[0].endMs = 1001; }],
    ["same target actor", (r: any) => { r.actions[0].targetActorId = "actor-1"; }],
    ["missing target", (r: any) => { r.actions[0].targetActorId = null; }],
    ["unverified edition inferred", (r: any) => { r.match.ifabVersionId = null; }],
    ["empty clip", (r: any) => { r.evidence[0].endMs = 0; }],
    ["unknown track segment", (r: any) => { r.actors[0].tracklets[0].segmentId = "missing"; }],
    ["team confirmed without value", (r: any) => { r.actors[0].teamId = null; }],
    ["unbounded text", (r: any) => { r.incidentId = "x".repeat(257); }],
  ])("rejects %s", (_name, mutate) => {
    const r = incidentFixture(); mutate(r); expect(incidentRecordData(r)).toBe(false);
  });
  it("accepts a frame with zero duration", () => {
    const r: any = incidentFixture(); r.evidence[0].kind = "FRAME"; r.evidence[0].endMs = 0;
    expect(incidentRecordData(r)).toBe(true);
  });
  it("rejects cyclic input safely", () => { const r: any = incidentFixture(); r.match = r; expect(incidentRecordData(r)).toBe(false); });
  it.each(["evidenceIds", "reasons"])("rejects sparse assertion %s", field => {
    const r: any = incidentFixture();
    r.actions[0].observations.pulling[field] = new Array(1);
    expect(incidentRecordData(r)).toBe(false);
  });
  it("rejects extra array properties", () => {
    const r: any = incidentFixture(); r.links.verdict = "FOUL";
    expect(incidentRecordData(r)).toBe(false);
  });
  it("accepts all five action families together without argmax or inferred links", () => {
    const r: any = incidentFixture();
    const base = r.actions[0];
    r.actions = Object.entries(INCIDENT_OBSERVATION_KEYS).map(([type, fields], i) => ({
      ...base, id: `action-${i + 2}`, type, targetActorId: type === "HAND_ARM_BALL_CONTACT" ? null : "actor-2",
      context: Object.fromEntries(Object.keys(base.context).map(k => [k, incidentAssertion(`a${i}.context.${k}`)])),
      observations: Object.fromEntries(fields.map(k => [k, incidentAssertion(`a${i}.observations.${k}`, "UNKNOWN")])),
    }));
    expect(incidentRecordData(r)).toBe(true);
    expect(r.links).toEqual([]);
  });
  it("validates image measurement units, finiteness, proof and unknown values", () => {
    const r: any = incidentFixture();
    const measurement = { ...incidentAssertion("m1"), state: "KNOWN", quantity: "IMAGE_SPEED", value: 10, unit: "px_per_s" };
    r.actions[0].measurements = [measurement];
    expect(incidentRecordData(r)).toBe(true);
    for (const invalid of [{ unit: "m/s" }, { unit: "N" }, { value: Infinity }, { evidenceIds: [] }, { state: "UNKNOWN" }, { id: "e1" }, { severity: "RECKLESS" }]) {
      r.actions[0].measurements = [{ ...measurement, ...invalid }];
      expect(incidentRecordData(r)).toBe(false);
    }
    r.actions[0].measurements = [{ ...measurement, state: "UNKNOWN", value: null, evidenceIds: [], reasons: ["occluded"] }];
    expect(incidentRecordData(r)).toBe(true);
  });
  it("keeps referee null unknown distinct from confirmed NONE", () => {
    const r: any = incidentFixture();
    r.refereeDecisions = [{ id: "decision-1", phase: "INITIAL", segmentId: "s1", startMs: 0, endMs: 1000, restartType: null, restartBeneficiaryTeamId: null, card: "NONE", goalDecision: null,
      observations: { restart: incidentAssertion("ref.restart", "UNKNOWN"), beneficiary: incidentAssertion("ref.beneficiary", "UNKNOWN"), card: incidentAssertion("ref.card"), goal: incidentAssertion("ref.goal", "UNKNOWN") } }];
    expect(incidentRecordData(r)).toBe(true);
    r.refereeDecisions[0].card = null;
    expect(incidentRecordData(r)).toBe(false);
  });
  it("only accepts explicit links between existing different segments", () => {
    const r: any = incidentFixture();
    r.segments.push({ ...r.segments[0], id: "s2", replayState: "REPLAY", playbackSpeed: "SLOW" });
    r.links = [{ id: "link-1", firstSegmentId: "s1", secondSegmentId: "s2", relation: "SAME_INCIDENT", assessment: incidentAssertion("link-1.assessment", "UNKNOWN") }];
    expect(incidentRecordData(r)).toBe(true);
    for (const second of ["s1", "missing"]) { r.links[0].secondSegmentId = second; expect(incidentRecordData(r)).toBe(false); }
  });
  it.each(["within actor", "across actors"])("rejects duplicate tracklet ownership %s", location => {
    const r: any = incidentFixture();
    if (location === "within actor") r.actors[0].tracklets.push({ ...r.actors[0].tracklets[0] });
    else r.actors[1].tracklets = [{ ...r.actors[0].tracklets[0] }];
    expect(incidentRecordData(r)).toBe(false);
  });
  it.each(["UNKNOWN", "NOT_APPLICABLE", "REFUTED"])("requires null team identity when assignment is %s", state => {
    const r: any = incidentFixture();
    r.actors[0].teamAssignment = incidentAssertion("actor-1.team", state as any);
    expect(incidentRecordData(r)).toBe(false);
    r.actors[0].teamId = null;
    expect(incidentRecordData(r)).toBe(true);
  });
  it.each(["UNKNOWN", "NOT_APPLICABLE", "REFUTED"])("requires null referee values when observations are %s", state => {
    for (const [claim, field, affirmed] of [["restart", "restartType", "DIRECT_FREE_KICK"], ["beneficiary", "restartBeneficiaryTeamId", "team-1"], ["card", "card", "NONE"], ["goal", "goalDecision", "NO_GOAL"]]) {
      const r: any = incidentFixture();
      const d: any = { id: "decision-1", phase: "INITIAL", segmentId: "s1", startMs: 0, endMs: 1000, restartType: null, restartBeneficiaryTeamId: null, card: null, goalDecision: null,
        observations: Object.fromEntries(["restart", "beneficiary", "card", "goal"].map(k => [k, incidentAssertion(`ref.${k}`, "UNKNOWN")])) };
      d.observations[claim!] = incidentAssertion(`ref.${claim}`, state as any);
      d[field!] = affirmed; r.refereeDecisions = [d];
      expect(incidentRecordData(r)).toBe(false);
      d[field!] = null;
      expect(incidentRecordData(r)).toBe(true);
    }
  });
  it("bounds UTF-8 payload bytes, not only JavaScript string length", () => {
    const r: any = incidentFixture();
    r.actions[0].observations.pulling.reasons = Array.from({ length: 32 }, () => "한".repeat(1024));
    r.actions[0].observations.gripMaintained.reasons = Array.from({ length: 32 }, () => "한".repeat(1024));
    const base = r.actions[0];
    r.actions = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `multibyte-${i}`,
      context: Object.fromEntries(Object.entries(base.context).map(([k, v]: [string, any]) => [k, { ...v, id: `multi-${i}.context.${k}` }])),
      observations: Object.fromEntries(Object.entries(base.observations).map(([k, v]: [string, any]) => [k, { ...v, id: `multi-${i}.observations.${k}` }])),
    }));
    expect(JSON.stringify(r).length).toBeLessThan(1_000_000);
    expect(new TextEncoder().encode(JSON.stringify(r)).byteLength).toBeGreaterThan(1_000_000);
    expect(incidentRecordData(r)).toBe(false);
  });
  it.each(["yesterday", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "26-01-01"])("rejects invalid match date %s", date => {
    const r: any = incidentFixture(); r.match.matchDate = date;
    expect(incidentRecordData(r)).toBe(false);
    r.match.verification = "UNVERIFIED";
    expect(incidentRecordData(r)).toBe(false);
  });
  it("allows an actual leap day or an absent unverified date", () => {
    const r: any = incidentFixture(); r.match.matchDate = "2024-02-29";
    expect(incidentRecordData(r)).toBe(true);
    r.match.matchDate = null; r.match.verification = "UNVERIFIED";
    expect(incidentRecordData(r)).toBe(true);
  });
  it.each([["restart", "restartType"], ["goal", "goalDecision"]])("rejects confirmed legacy UNKNOWN %s sentinel", (claim, field) => {
    const r: any = incidentFixture();
    const d: any = { id: "decision-1", phase: "FINAL", segmentId: "s1", startMs: 0, endMs: 1000, restartType: null, restartBeneficiaryTeamId: null, card: null, goalDecision: null,
      observations: Object.fromEntries(["restart", "beneficiary", "card", "goal"].map(k => [k, incidentAssertion(`ref.${k}`, "UNKNOWN")])) };
    d.observations[claim] = incidentAssertion(`ref.${claim}`); d[field] = "UNKNOWN";
    r.refereeDecisions = [d];
    expect(incidentRecordData(r)).toBe(false);
  });
});
