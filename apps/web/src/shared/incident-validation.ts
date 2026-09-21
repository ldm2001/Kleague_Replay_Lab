import { INCIDENT_CONTEXT_KEYS, INCIDENT_OBSERVATION_KEYS, type IncidentActionType, type IncidentRecordV1 } from "./incident-record";
import { DISCIPLINARY_ACTIONS, GOAL_DECISIONS, RESTART_TYPES } from "./vocabulary";

type Data = Record<string, unknown>;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 256;
const nullableText = (v: unknown) => v === null || text(v);
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const calendarDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const oneOf = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);
const object = (v: unknown): v is Data => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: unknown, expected: readonly string[]): v is Data => object(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const span = (v: Data) => time(v.startMs) && time(v.endMs) && v.startMs <= v.endMs;
const proofKeys = ["id", "state", "origin", "method", "evidenceIds", "confidence", "reasons"];

/** Bounded structural validation only; provenance admission and normative assessment are separate. */
export function incidentRecordData(value: unknown): value is IncidentRecordV1 {
  try {
    // Reject cycles, non-JSON values and excessive nesting before any semantic traversal.
    let budget = 1_000_000;
    const active = new Set<object>();
    function bounded(v: unknown, depth: number): boolean {
      if (--budget < 0 || depth > 16) return false;
      if (v === null || typeof v === "boolean") return true;
      if (typeof v === "number") return Number.isFinite(v);
      if (typeof v === "string") { budget -= v.length; return budget >= 0 && v.length <= 1024; }
      if (typeof v !== "object" || active.has(v)) return false;
      active.add(v);
      const ok = (Array.isArray(v) ? v.length <= 4096 && Reflect.ownKeys(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i) && bounded(v[i], depth + 1)).every(Boolean) : object(v) && Reflect.ownKeys(v).length <= 64 && Reflect.ownKeys(v).every(k => typeof k === "string" && bounded(k, depth + 1) && bounded(v[k], depth + 1)));
      active.delete(v); return ok;
    }
    if (!bounded(value, 0) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_000_000) return false;
    if (!keys(value, ["schemaVersion", "incidentId", "sourceSha256", "match", "segments", "evidence", "actors", "links", "actions", "refereeDecisions"]) || value.schemaVersion !== "incident-record-v1" || !text(value.incidentId) || !sha(value.sourceSha256)) return false;
    const m = value.match;
    const matchKeys = ["matchId", "competition", "season", "matchDate", "ifabVersionId"];
    if (!keys(m, [...matchKeys, "verification"]) || !oneOf(m.verification, ["VERIFIED", "UNVERIFIED"]) || !matchKeys.every(k => nullableText(m[k])) || (m.verification === "VERIFIED" && !matchKeys.every(k => text(m[k])))) return false;
    if (m.matchDate !== null && !calendarDate(m.matchDate)) return false;
    if (!list(value.segments, 256) || !value.segments.length || !list(value.evidence, 2048) || !list(value.actors, 256) || !list(value.links, 512) || !list(value.actions, 256) || !list(value.refereeDecisions, 128)) return false;
    const ids = new Set<string>([value.incidentId]);
    function id(v: unknown): v is string { if (!text(v) || ids.has(v)) return false; ids.add(v); return true; }
    const segments = new Map<string, Data>();
    for (const s of value.segments) {
      if (!keys(s, ["id", "shotId", "cameraId", "startMs", "endMs", "playbackSpeed", "replayState", "matchClockMs"]) || !id(s.id) || !text(s.shotId) || !nullableText(s.cameraId) || !span(s) || s.startMs === s.endMs || !oneOf(s.playbackSpeed, ["NORMAL", "SLOW", "UNKNOWN"]) || !oneOf(s.replayState, ["LIVE", "REPLAY", "UNKNOWN"]) || !(s.matchClockMs === null || time(s.matchClockMs))) return false;
      segments.set(s.id, s);
    }
    function contained(v: Data): boolean {
      const s = typeof v.segmentId === "string" ? segments.get(v.segmentId) : undefined;
      return !!s && span(v) && (v.startMs as number) >= (s.startMs as number) && (v.endMs as number) <= (s.endMs as number);
    }
    const evidence = new Set<string>();
    for (const e of value.evidence) {
      if (!keys(e, ["id", "segmentId", "kind", "startMs", "endMs", "contentSha256"]) || !id(e.id) || !oneOf(e.kind, ["FRAME", "CLIP"]) || !contained(e) || (e.kind === "CLIP" && e.startMs === e.endMs) || !sha(e.contentSha256)) return false;
      evidence.add(e.id);
    }
    function proof(v: Data): boolean {
      return id(v.id) && oneOf(v.origin, ["IMAGE_MEASUREMENT", "MODEL_ESTIMATE", "EVENT_LINK"]) && keys(v.method, ["id", "version"]) && text(v.method.id) && text(v.method.version) && list(v.evidenceIds, 128) && v.evidenceIds.every(e => typeof e === "string" && evidence.has(e)) && new Set(v.evidenceIds).size === v.evidenceIds.length && (v.confidence === null || (typeof v.confidence === "number" && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1)) && list(v.reasons, 32) && v.reasons.every(r => typeof r === "string" && r.trim().length > 0 && r.length <= 1024);
    }
    function assertion(v: unknown): boolean {
      if (!keys(v, proofKeys) || !oneOf(v.state, ["CONFIRMED", "REFUTED", "UNKNOWN", "NOT_APPLICABLE"]) || !proof(v)) return false;
      return v.state === "CONFIRMED" || v.state === "REFUTED" ? (v.evidenceIds as unknown[]).length > 0 && (v.reasons as unknown[]).length === 0 : (v.reasons as unknown[]).length > 0;
    }
    function assertions(v: unknown, names: readonly string[]): boolean { return keys(v, names) && names.every(k => assertion(v[k])); }
    const actors = new Set<string>();
    const tracklets = new Set<string>();
    for (const a of value.actors) {
      if (!keys(a, ["id", "tracklets", "teamId", "teamAssignment"]) || !id(a.id) || !nullableText(a.teamId) || !assertion(a.teamAssignment) || (((a.teamAssignment as Data).state === "CONFIRMED") !== (a.teamId !== null)) || !list(a.tracklets, 256)) return false;
      for (const t of a.tracklets) {
        if (!keys(t, ["segmentId", "continuityId", "trackId"]) || typeof t.segmentId !== "string" || !segments.has(t.segmentId) || !text(t.continuityId) || !text(t.trackId)) return false;
        const tuple = JSON.stringify([t.segmentId, t.continuityId, t.trackId]);
        if (tracklets.has(tuple)) return false;
        tracklets.add(tuple);
      }
      actors.add(a.id);
    }
    for (const l of value.links) {
      if (!keys(l, ["id", "firstSegmentId", "secondSegmentId", "relation", "assessment"]) || !id(l.id) || typeof l.firstSegmentId !== "string" || !segments.has(l.firstSegmentId) || typeof l.secondSegmentId !== "string" || !segments.has(l.secondSegmentId) || l.firstSegmentId === l.secondSegmentId || !oneOf(l.relation, ["SAME_INCIDENT", "BEFORE", "AFTER", "SIMULTANEOUS"]) || !assertion(l.assessment)) return false;
    }
    const units = { IMAGE_DISTANCE: "px", IMAGE_SPEED: "px_per_s", ANGLE: "deg", DURATION: "ms" };
    function measurement(v: unknown): boolean {
      if (!keys(v, [...proofKeys, "quantity", "value", "unit"]) || !proof(v) || !oneOf(v.quantity, Object.keys(units)) || v.unit !== units[v.quantity as keyof typeof units]) return false;
      return v.state === "KNOWN" ? typeof v.value === "number" && Number.isFinite(v.value) && (v.evidenceIds as unknown[]).length > 0 && (v.reasons as unknown[]).length === 0 : v.state === "UNKNOWN" && v.value === null && (v.reasons as unknown[]).length > 0;
    }
    for (const a of value.actions) {
      if (!keys(a, ["id", "type", "actorId", "targetActorId", "segmentId", "startMs", "endMs", "context", "observations", "measurements"]) || !id(a.id) || !oneOf(a.type, Object.keys(INCIDENT_OBSERVATION_KEYS)) || typeof a.actorId !== "string" || !actors.has(a.actorId) || !(a.targetActorId === null ? a.type === "HAND_ARM_BALL_CONTACT" : typeof a.targetActorId === "string" && actors.has(a.targetActorId) && a.targetActorId !== a.actorId) || !contained(a) || !assertions(a.context, INCIDENT_CONTEXT_KEYS) || !assertions(a.observations, INCIDENT_OBSERVATION_KEYS[a.type as IncidentActionType]) || !list(a.measurements, 128) || !a.measurements.every(measurement)) return false;
    }
    for (const d of value.refereeDecisions) {
      if (!keys(d, ["id", "phase", "segmentId", "startMs", "endMs", "restartType", "restartBeneficiaryTeamId", "card", "goalDecision", "observations"]) || !id(d.id) || !oneOf(d.phase, ["INITIAL", "REVISED", "FINAL", "UNKNOWN"]) || !contained(d) || !(d.restartType === null || oneOf(d.restartType, RESTART_TYPES)) || !nullableText(d.restartBeneficiaryTeamId) || !(d.card === null || oneOf(d.card, DISCIPLINARY_ACTIONS)) || !(d.goalDecision === null || oneOf(d.goalDecision, GOAL_DECISIONS)) || !assertions(d.observations, ["restart", "beneficiary", "card", "goal"])) return false;
      if (d.restartType === "UNKNOWN" || d.goalDecision === "UNKNOWN") return false;
      for (const [claim, field] of [["restart", "restartType"], ["beneficiary", "restartBeneficiaryTeamId"], ["card", "card"], ["goal", "goalDecision"]]) {
        if (((((d.observations as Data)[claim!] as Data).state === "CONFIRMED") !== (d[field!] !== null))) return false;
      }
    }
    return true;
  } catch { return false; }
}
