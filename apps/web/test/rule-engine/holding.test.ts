import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { incidentFixture, incidentAssertion } from "../fixtures/incident-record";
import { evaluateHolding, publicIncidentConclusions } from "../../src/rules/engine/incidents/holding";
import { incidentRecordSignature, readIncidentAssertion } from "../../src/rules/engine/incidents/evidence";
import type { IncidentRecordV1, IncidentAssertion } from "../../src/shared/incident-record";

const fixture = () => {
  const record = incidentFixture();
  record.match.ifabVersionId = "ifab-2025-26";
  return record;
};
const holding = (record: IncidentRecordV1) => {
  const action = record.actions[0]!;
  if (action.type !== "HOLDING_MOTION") throw new Error("fixture-type");
  return action;
};
const admit = (record: IncidentRecordV1) => ({
  incidentId: record.incidentId, sourceSha256: record.sourceSha256, recordSha256: incidentRecordSignature(record),
  factIds: new Set([
    ...record.actors.map((actor) => actor.teamAssignment.id),
    ...record.actions.flatMap((action) => [...Object.values(action.context), ...Object.values(action.observations)].map((fact) => fact.id)),
    ...record.links.map((link) => link.assessment.id),
  ]), evidenceHashes: new Map(record.evidence.map((evidence) => [evidence.id, evidence.contentSha256])),
});
const evaluate = (record = fixture()) => evaluateHolding(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission: admit(record) });
const change = (fact: IncidentAssertion, state: IncidentAssertion["state"]) => {
  fact.state = state; fact.reasons = state === "UNKNOWN" || state === "NOT_APPLICABLE" ? ["MISSING_VIEW"] : [];
};

describe("holding question-specific conclusions", () => {
  it.each(["ifab-2025-26", "ifab-2026-27"])("evaluates only with the explicitly selected %s references", (version) => {
    const record = fixture(); record.match.ifabVersionId = version;
    const result = evaluateHolding(record, "action-1", { rules: ruleSet(version)!, admission: admit(record) });
    expect(result.conclusions.offence.status).toBe("COMPLETED");
    expect(result.conclusions.restart.status).toBe("COMPLETED");
    expect(result.conclusions.offence.citations.every((citation) => `ifab-${citation.edition}` === version)).toBe(true);
  });
  it("completes holding and DFK while leaving disciplinary and referee/VAR questions unevaluated", () => {
    const result = evaluate();
    expect(result.conclusions.offence).toMatchObject({ status: "COMPLETED", value: "HOLDING_OFFENCE" });
    expect(result.conclusions.restart).toMatchObject({ status: "COMPLETED", value: { type: "DIRECT_FREE_KICK", beneficiaryTeamId: "team-2" } });
    expect(result.conclusions.disciplinary).toMatchObject({ status: "UNSUPPORTED", value: null });
    expect(result.conclusions.risk.status).toBe("NOT_APPLICABLE");
    expect(result.conclusions.originalDecisionComparison.status).toBe("UNSUPPORTED");
    expect(result.conclusions.varIntervention.status).toBe("UNSUPPORTED");
  });

  it("does not require duration, pulling or a CARELESS label to establish holding", () => {
    const record = fixture();
    expect(holding(record).observations.gripMaintained.state).toBe("UNKNOWN");
    expect(holding(record).observations.pulling.state).toBe("UNKNOWN");
    expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
  });

  it("unknown location blocks restart, not holding establishment", () => {
    const record = fixture(); change(holding(record).context.insideOwnPenaltyArea, "UNKNOWN");
    expect(evaluate(record).conclusions).toMatchObject({ offence: { status: "COMPLETED" }, restart: { status: "UNDETERMINED", value: null } });
  });

  it.each(["UNKNOWN", "NOT_APPLICABLE"] as const)("movement %s does not become a negative or a foul", (state) => {
    const record = fixture(); change(holding(record).observations.movementImpeded, state);
    expect(evaluate(record).conclusions.offence).toMatchObject({ status: "UNDETERMINED", value: null });
  });

  it.each(["bodyOrEquipmentContact", "movementImpeded"] as const)("confirmed negative %s rules out this holding question only", (key) => {
    const record = fixture(); change(holding(record).observations[key], "REFUTED");
    // A contact-caused impediment cannot be confirmed alongside no contact.
    if (key === "bodyOrEquipmentContact") change(holding(record).observations.movementImpeded, "UNKNOWN");
    const result = evaluate(record);
    expect(result.conclusions.offence).toMatchObject({ status: "COMPLETED", value: "NO_HOLDING_OFFENCE" });
    expect(result.conclusions.restart.status).toBe("NOT_APPLICABLE");
    expect(result.conclusions.disciplinary.value).toBeNull();
  });

  it.each(["gripMaintained", "pulling", "movementImpeded"] as const)("holds conflicting admitted contact and %s observations", (key) => {
    const record = fixture(), action = holding(record);
    change(action.observations.bodyOrEquipmentContact, "REFUTED");
    change(action.observations.movementImpeded, "UNKNOWN");
    change(action.observations[key], "CONFIRMED");
    const result = evaluate(record);
    expect(result.conclusions.offence).toMatchObject({ status: "UNDETERMINED", reasonCodes: ["OBSERVATION_CONFLICT"] });
    expect(result.conclusions.restart.status).toBe("UNDETERMINED");
    expect(result.factDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: action.observations[key].id, reasons: ["OBSERVATION_CONFLICT"] }),
      expect.objectContaining({ factId: action.observations.bodyOrEquipmentContact.id, reasons: ["OBSERVATION_CONFLICT"] }),
    ]));
    expect(publicIncidentConclusions(result).conclusions).toEqual([]);
  });

  it.each(["UNKNOWN", "UNADMITTED", "BAD_HASH", "SHORT_CLIP"])("does not treat %s grip as an admitted conflict", (mode) => {
    const record = fixture(), action = holding(record);
    change(action.observations.bodyOrEquipmentContact, "REFUTED");
    change(action.observations.movementImpeded, "UNKNOWN");
    if (mode !== "UNKNOWN") change(action.observations.gripMaintained, "CONFIRMED");
    record.evidence = [...record.evidence, { ...record.evidence[0]!, id: "grip-proof", endMs: mode === "SHORT_CLIP" ? 100 : 1000 }];
    action.observations.gripMaintained.evidenceIds = ["grip-proof"];
    const admission = admit(record);
    if (mode === "UNADMITTED") admission.factIds.delete(action.observations.gripMaintained.id);
    if (mode === "BAD_HASH") admission.evidenceHashes.delete("grip-proof");
    const result = evaluateHolding(record, action.id, { rules: ruleSet("ifab-2025-26")!, admission });
    expect(result.conclusions.offence).toMatchObject({ status: "COMPLETED", value: "NO_HOLDING_OFFENCE" });
  });

  it.each(["HASH", "ADMISSION", "TIME", "LINK"])("preserves private fact-level %s blocking reasons", (mode) => {
    const record = fixture(), action = holding(record), fact = action.context.ballInPlay;
    record.evidence = [...record.evidence, { ...record.evidence[0]!, id: "context-proof", endMs: mode === "TIME" ? 100 : 1000 }];
    fact.evidenceIds = ["context-proof"];
    if (mode === "LINK") {
      record.segments = [...record.segments, { ...record.segments[0]!, id: "s2" }];
      record.evidence[1]!.segmentId = "s2";
    }
    const admission = admit(record);
    if (mode === "HASH") admission.evidenceHashes.delete("context-proof");
    if (mode === "ADMISSION") admission.factIds.delete(fact.id);
    const reason = { HASH: "EVIDENCE_HASH_UNVERIFIED", ADMISSION: "FACT_NOT_ADMITTED", TIME: "TEMPORAL_COVERAGE_INSUFFICIENT", LINK: "VIEW_LINK_UNVERIFIED" }[mode]!;
    const result = evaluateHolding(record, action.id, { rules: ruleSet("ifab-2025-26")!, admission });
    expect(result.conclusions.offence.status).toBe("UNDETERMINED");
    expect(result).toHaveProperty("factDiagnostics", expect.arrayContaining([
      expect.objectContaining({ factId: fact.id, state: "UNKNOWN", reasons: [reason] }),
    ]));
    expect(JSON.stringify(publicIncidentConclusions(result))).not.toContain(reason);
    expect(publicIncidentConclusions(result)).not.toHaveProperty("factDiagnostics");
  });

  it.each(["movementImpeded", "insideOwnPenaltyArea"] as const)("retains %s diagnostics beyond context checks", (key) => {
    const record = fixture(), action = holding(record);
    const fact = key === "movementImpeded" ? action.observations[key] : action.context[key];
    const admission = admit(record);
    admission.factIds.delete(fact.id);
    const result = evaluateHolding(record, action.id, { rules: ruleSet("ifab-2025-26")!, admission });
    expect(result.factDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: fact.id, state: "UNKNOWN", reasons: ["FACT_NOT_ADMITTED"] }),
    ]));
    expect(result.conclusions.offence.status).toBe(key === "movementImpeded" ? "UNDETERMINED" : "COMPLETED");
    expect(result.conclusions.restart.status).toBe("UNDETERMINED");
    expect(publicIncidentConclusions(result)).not.toHaveProperty("factDiagnostics");
  });

  it.each(["ballInPlay", "stoppedForThisAction", "advantageApplied", "otherActionInRestartSequence"] as const)("unknown %s prevents a restart conclusion", (key) => {
    const record = fixture(); change(holding(record).context[key], "UNKNOWN");
    expect(evaluate(record).conclusions.restart.status).toBe("UNDETERMINED");
  });

  it("confirmed advantage is not automatically converted into an awarded free kick", () => {
    const record = fixture(); change(holding(record).context.advantageApplied, "CONFIRMED");
    expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
    expect(evaluate(record).conclusions.restart.status).not.toBe("COMPLETED");
  });

  it("out-of-play holding is outside this evaluator's in-play offence scope, not no foul", () => {
    const record = fixture(); change(holding(record).context.ballInPlay, "REFUTED");
    expect(evaluate(record).conclusions.offence).toMatchObject({ status: "UNSUPPORTED", value: null });
  });

  it("out-of-field location does not erase holding but needs separate restart rules", () => {
    const record = fixture(); change(holding(record).context.onField, "REFUTED");
    expect(evaluate(record).conclusions).toMatchObject({ offence: { status: "COMPLETED" }, restart: { status: "UNSUPPORTED" } });
  });

  it("an offence anywhere inside the offender's area supports a penalty, independent of card data", () => {
    const record = fixture(); change(holding(record).context.insideOwnPenaltyArea, "CONFIRMED");
    expect(evaluate(record).conclusions.restart).toMatchObject({ status: "COMPLETED", value: { type: "PENALTY_KICK", beneficiaryTeamId: "team-2" } });
  });

  it("unknown beneficiary preserves holding but blocks restart", () => {
    const record = fixture(); record.actors[1]!.teamId = null; change(record.actors[1]!.teamAssignment, "UNKNOWN");
    expect(evaluate(record).conclusions).toMatchObject({ offence: { status: "COMPLETED" }, restart: { status: "UNDETERMINED" } });
  });

  it("does not select restart priority when the same incident contains another action", () => {
    const record = fixture();
    const second = structuredClone(holding(record)); second.id = "action-2";
    for (const fact of [...Object.values(second.context), ...Object.values(second.observations)]) fact.id = fact.id.replace("action-1", "action-2");
    record.actions = [...record.actions, second];
    expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
    expect(evaluate(record).conclusions.restart.status).toBe("UNSUPPORTED");
  });

  it("does not classify a different observed action as no foul through the holding evaluator", () => {
    const record = fixture(); const first = holding(record);
    record.actions = [{ ...first, type: "PUSHING_MOTION", observations: {
      actionObserved: first.observations.actionObserved, bodyContact: first.observations.bodyOrEquipmentContact,
      extensionTowardOpponent: first.observations.gripMaintained, opponentMotionChanged: first.observations.movementImpeded,
    } }];
    expect(evaluate(record).conclusions.offence.status).toBe("UNSUPPORTED");
  });

  it("conflicting actual teams do not get resolved by attacking/defending role defaults", () => {
    const record = fixture(); record.actors[1]!.teamId = "team-1";
    expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
  });

  it("a high-confidence model claim is not admitted merely by its state", () => {
    const record = fixture(); const admission = admit(record); admission.factIds.clear();
    expect(evaluateHolding(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission }).conclusions.offence.status).toBe("UNDETERMINED");
  });

  it("binds admission to the complete observation record and evidence bytes", () => {
    const record = fixture(); const admission = admit(record);
    change(holding(record).observations.movementImpeded, "REFUTED");
    expect(evaluateHolding(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission }).conclusions.offence.status).toBe("UNDETERMINED");
    const current = admit(record); current.evidenceHashes.set("e1", "c".repeat(64));
    expect(evaluateHolding(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission: current }).conclusions.offence.status).toBe("UNDETERMINED");
  });

  it("does not treat one frame as proof of movement over the episode", () => {
    const record = fixture(); record.evidence[0]!.kind = "FRAME"; record.evidence[0]!.startMs = 500; record.evidence[0]!.endMs = 500;
    expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
  });

  it("slower footage can establish contact but cannot be substituted for normal-speed risk evidence", () => {
    const record = fixture(); record.segments[0]!.playbackSpeed = "SLOW";
    expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
    expect(readIncidentAssertion(record, holding(record), holding(record).observations.bodyOrEquipmentContact, admit(record), { normalSpeed: true }).state).toBe("UNKNOWN");
  });

  it("will not combine unlinked replay evidence, but admits an independently approved same-incident link", () => {
    const record = fixture();
    record.segments = [...record.segments, { ...record.segments[0]!, id: "s2", shotId: "shot-2", startMs: 2000, endMs: 3000, replayState: "REPLAY" }];
    record.evidence = [...record.evidence, { ...record.evidence[0]!, id: "e2", segmentId: "s2", startMs: 2000, endMs: 3000 }];
    holding(record).observations.movementImpeded.evidenceIds = ["e2"];
    expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
    const assessment = incidentAssertion("same-incident-link"); assessment.evidenceIds = ["e1", "e2"];
    record.links = [{ id: "link-1", firstSegmentId: "s1", secondSegmentId: "s2", relation: "SAME_INCIDENT", assessment }];
    expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
  });

  it("rejects missing or mixed rule editions without erasing evidence", () => {
    const record = fixture();
    expect(evaluateHolding(record, "action-1", { rules: ruleSet("ifab-2026-27")!, admission: admit(record) }).conclusions.offence.status).toBe("UNDETERMINED");
    record.match.verification = "UNVERIFIED";
    expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
  });

  it("publishes completed questions only, not raw claims or private blocking reasons", () => {
    const result = publicIncidentConclusions(evaluate());
    expect(result.conclusions.map((item) => item.question)).toEqual(["offence", "restart"]);
    expect(result.notAssessed).toContain("disciplinary");
    expect(JSON.stringify(result)).not.toContain("MODEL_ESTIMATE");
    expect(JSON.stringify(result)).not.toContain("MISSING_VIEW");
    expect(result).not.toHaveProperty("facts");
  });
});
