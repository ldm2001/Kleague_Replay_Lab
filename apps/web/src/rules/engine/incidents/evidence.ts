import { createHash } from "node:crypto";
import type { IncidentAction, IncidentAssertion, IncidentEvidence, IncidentRecordV1 } from "../../../shared/incident-record";
import { incidentRecordData } from "../../../shared/incident-validation";

// Server-owned receipt, never part of a Worker IncidentRecord or inferred from confidence.
export interface IncidentAdmission {
  incidentId: string;
  sourceSha256: string;
  recordSha256: string;
  factIds: ReadonlySet<string>;
  evidenceHashes: ReadonlyMap<string, string>;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

export const incidentRecordSignature = (record: IncidentRecordV1): string => {
  if (!incidentRecordData(record)) throw new Error("INCIDENT_RECORD_INVALID");
  return createHash("sha256").update(canonical(record)).digest("hex");
};

export const incidentAdmissionMatches = (record: IncidentRecordV1, admission: IncidentAdmission): boolean =>
  admission.incidentId === record.incidentId && admission.sourceSha256 === record.sourceSha256 &&
  admission.recordSha256 === incidentRecordSignature(record);

export interface IncidentAssertionRead {
  state: IncidentAssertion["state"];
  factIds: readonly string[];
  evidenceIds: readonly string[];
  reasons: readonly string[];
}

export const readIncidentAssertion = (
  record: IncidentRecordV1, action: IncidentAction, fact: IncidentAssertion, admission: IncidentAdmission,
  options: Readonly<{ temporal?: boolean; normalSpeed?: boolean }> = {},
): IncidentAssertionRead => {
  const unknown = (reason: string): IncidentAssertionRead => ({ state: "UNKNOWN", factIds: [], evidenceIds: [], reasons: [reason] });
  if (!incidentAdmissionMatches(record, admission)) return unknown("ADMISSION_RECORD_MISMATCH");
  const ownedAction = record.actions.find((item) => item.id === action.id);
  if (!ownedAction || canonical(ownedAction) !== canonical(action)) return unknown("ASSERTION_ACTION_MISMATCH");
  const owned = [...Object.values(action.context), ...Object.values(action.observations),
    ...record.actors.filter((actor) => actor.id === action.actorId || actor.id === action.targetActorId).map((actor) => actor.teamAssignment)]
    .find((item) => item.id === fact.id);
  if (!owned || canonical(owned) !== canonical(fact)) return unknown("ASSERTION_ACTION_MISMATCH");
  if (fact.state === "UNKNOWN" || fact.state === "NOT_APPLICABLE") return { state: fact.state, factIds: [], evidenceIds: [], reasons: fact.reasons };
  if (!admission.factIds.has(fact.id)) return unknown("FACT_NOT_ADMITTED");
  const byId = new Map(record.evidence.map((item) => [item.id, item]));
  const segments = new Map(record.segments.map((item) => [item.id, item]));
  const evidence: IncidentEvidence[] = [];
  const linkedFacts: string[] = [];
  const linkedEvidence: string[] = [];
  for (const id of fact.evidenceIds) {
    const item = byId.get(id);
    if (!item || admission.evidenceHashes.get(id) !== item.contentSha256) return unknown("EVIDENCE_HASH_UNVERIFIED");
    if (item.segmentId !== action.segmentId) {
      const link = record.links.find((link) => link.relation === "SAME_INCIDENT" &&
        ((link.firstSegmentId === action.segmentId && link.secondSegmentId === item.segmentId) ||
         (link.secondSegmentId === action.segmentId && link.firstSegmentId === item.segmentId)) &&
        link.assessment.state === "CONFIRMED" && admission.factIds.has(link.assessment.id) &&
        link.assessment.evidenceIds.every((proofId) => byId.has(proofId) && admission.evidenceHashes.get(proofId) === byId.get(proofId)!.contentSha256) &&
        [action.segmentId, item.segmentId].every((segmentId) => link.assessment.evidenceIds.some((proofId) => byId.get(proofId)?.segmentId === segmentId)));
      if (!link) return unknown("VIEW_LINK_UNVERIFIED");
      linkedFacts.push(link.assessment.id);
      linkedEvidence.push(...link.assessment.evidenceIds);
    } else if (item.endMs < action.startMs || item.startMs > action.endMs) return unknown("EVIDENCE_OUTSIDE_ACTION");
    evidence.push(item);
  }
  const eligible = options.normalSpeed ? evidence.filter((item) => segments.get(item.segmentId)?.playbackSpeed === "NORMAL") : evidence;
  if (!eligible.length) return unknown(options.normalSpeed ? "NORMAL_SPEED_REQUIRED" : "EVIDENCE_MISSING");
  if (options.temporal && !eligible.some((item) => {
    const segment = segments.get(item.segmentId)!;
    const start = item.segmentId === action.segmentId ? action.startMs : segment.startMs;
    const end = item.segmentId === action.segmentId ? action.endMs : segment.endMs;
    return item.kind === "CLIP" && item.startMs <= start && item.endMs >= end;
  })) return unknown("TEMPORAL_COVERAGE_INSUFFICIENT");
  return { state: fact.state, factIds: [fact.id, ...new Set(linkedFacts)], evidenceIds: [...new Set([...eligible.map((item) => item.id), ...linkedEvidence])], reasons: [] };
};
