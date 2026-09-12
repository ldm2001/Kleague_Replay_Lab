export type PerceptionModelComponent = "detector" | "role" | "pose";

export type PerceptionModelProvenance = Readonly<{
  component: PerceptionModelComponent;
  modelId: string;
  revision: string;
  weightsSha256: string;
}>;

export type PerceptionIncident = Readonly<{
  id: string;
  candidateIndex: number;
  continuityId: number;
  startMs: number;
  endMs: number;
  evidenceIndices: readonly number[];
  officialRole: "MAIN_CANDIDATE" | "ASSISTANT_CANDIDATE" | "UNKNOWN";
  signal: "RAISED_ARM" | "FLAG_LIKE" | "YELLOW_CARD_LIKE" | "RED_CARD_LIKE" | "UNKNOWN";
  contact: "UNVERIFIED";
  originalDecision: "UNKNOWN";
  restart: "UNVERIFIED";
  reasons: readonly string[];
}>;

export type PerceptionRun = Readonly<{
  schemaVersion: "perception-run-v1";
  sourceSha256: string;
  processingStatus: "COMPLETE" | "PARTIAL";
  coverage: Readonly<{
    startMs: number;
    endMs: number;
    sampleIntervalMs: number;
    expectedSamples: number;
    processedSamples: number;
    failedSamples: number;
  }>;
  models: readonly PerceptionModelProvenance[];
  artifact: Readonly<{
    objectKey: string;
    contentType: "application/gzip";
    contentSha256: string;
    sizeBytes: number;
  }>;
  summary: Readonly<{
    roleObservationCount: number;
    poseObservationCount: number;
    officialCueCount: number;
    interactionCount: number;
    linkCount: number;
    truncated: boolean;
    reasons: readonly string[];
  }>;
  incidents: readonly PerceptionIncident[];
}>;

export type PerceptionCandidateReference = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
}>;

export type PerceptionEvidenceReference = Readonly<{
  candidateIndex: number;
  startMs: number;
  endMs: number;
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ARTIFACT_KEY = new RegExp(`^perception/${UUID}/${UUID}/[1-9][0-9]*/([a-f0-9]{64})\\.jsonl\\.gz$`);
const MAX_RUN_BYTES = 256 * 1_024;
const MAX_ARTIFACT_BYTES = 128 * 1_024 * 1_024;
const MAX_INCIDENTS = 128;
const MAX_REASONS = 32;
const MAX_REFERENCES = 16;

const object = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const safe = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

const reasons = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= MAX_REASONS && value.every((item) => boundedText(item, 128));

const coverageData = (value: unknown): boolean => {
  if (!object(value, ["startMs", "endMs", "sampleIntervalMs", "expectedSamples", "processedSamples", "failedSamples"])) {
    return false;
  }
  if (!safe(value.startMs) || !safe(value.endMs) || value.endMs <= value.startMs ||
    !safe(value.sampleIntervalMs) || value.sampleIntervalMs === 0 ||
    !safe(value.expectedSamples) || !safe(value.processedSamples) || !safe(value.failedSamples)) {
    return false;
  }
  const spanMs = value.endMs - value.startMs;
  const calculatedSamples = Math.ceil(spanMs / value.sampleIntervalMs);
  const completedSamples = value.processedSamples + value.failedSamples;
  return safe(spanMs) && spanMs > 0 && safe(calculatedSamples) && calculatedSamples > 0 &&
    value.expectedSamples === calculatedSamples && safe(completedSamples) && completedSamples <= value.expectedSamples;
};

const modelData = (value: unknown): value is PerceptionModelProvenance => {
  if (!object(value, ["component", "modelId", "revision", "weightsSha256"])) return false;
  return ["detector", "role", "pose"].includes(value.component as string) &&
    boundedText(value.modelId, 160) && boundedText(value.revision, 64) &&
    typeof value.weightsSha256 === "string" && SHA256.test(value.weightsSha256);
};

const artifactData = (value: unknown): boolean => {
  if (!object(value, ["objectKey", "contentType", "contentSha256", "sizeBytes"])) return false;
  if (typeof value.objectKey !== "string" || typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256) || value.contentType !== "application/gzip" ||
    !safe(value.sizeBytes) || value.sizeBytes === 0 || value.sizeBytes > MAX_ARTIFACT_BYTES) {
    return false;
  }
  const match = ARTIFACT_KEY.exec(value.objectKey);
  return match?.[1] === value.contentSha256;
};

const summaryData = (value: unknown): boolean => {
  if (!object(value, [
    "roleObservationCount", "poseObservationCount", "officialCueCount", "interactionCount",
    "linkCount", "truncated", "reasons",
  ])) return false;
  return safe(value.roleObservationCount) && safe(value.poseObservationCount) &&
    safe(value.officialCueCount) && safe(value.interactionCount) && safe(value.linkCount) &&
    typeof value.truncated === "boolean" && reasons(value.reasons);
};

const incidentData = (value: unknown): value is PerceptionIncident => {
  if (!object(value, [
    "id", "candidateIndex", "continuityId", "startMs", "endMs", "evidenceIndices",
    "officialRole", "signal", "contact", "originalDecision", "restart", "reasons",
  ])) return false;
  if (!boundedText(value.id, 128) || !safe(value.candidateIndex) || !safe(value.continuityId) ||
    !safe(value.startMs) || !safe(value.endMs) || value.endMs <= value.startMs ||
    !Array.isArray(value.evidenceIndices) || value.evidenceIndices.length > MAX_REFERENCES ||
    !value.evidenceIndices.every(safe) || new Set(value.evidenceIndices).size !== value.evidenceIndices.length) {
    return false;
  }
  return ["MAIN_CANDIDATE", "ASSISTANT_CANDIDATE", "UNKNOWN"].includes(value.officialRole as string) &&
    ["RAISED_ARM", "FLAG_LIKE", "YELLOW_CARD_LIKE", "RED_CARD_LIKE", "UNKNOWN"].includes(value.signal as string) &&
    value.contact === "UNVERIFIED" && value.originalDecision === "UNKNOWN" &&
    value.restart === "UNVERIFIED" && reasons(value.reasons);
};

const jsonSize = (value: unknown): number | null => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
};

export const perceptionRunData = (value: unknown): value is PerceptionRun => {
  const size = jsonSize(value);
  if (size === null || size > MAX_RUN_BYTES || !object(value, [
    "schemaVersion", "sourceSha256", "processingStatus", "coverage", "models", "artifact", "summary", "incidents",
  ])) return false;
  if (value.schemaVersion !== "perception-run-v1" || typeof value.sourceSha256 !== "string" ||
    !SHA256.test(value.sourceSha256) || !["COMPLETE", "PARTIAL"].includes(value.processingStatus as string) ||
    !coverageData(value.coverage) || !Array.isArray(value.models) || value.models.length !== 3 ||
    !value.models.every(modelData) || !artifactData(value.artifact) || !summaryData(value.summary) ||
    !Array.isArray(value.incidents) || value.incidents.length > MAX_INCIDENTS || !value.incidents.every(incidentData)) {
    return false;
  }
  const run = value as unknown as PerceptionRun;
  const components = new Set(run.models.map((item) => item.component));
  if (components.size !== 3 || !["detector", "role", "pose"].every((item) => components.has(item as PerceptionModelComponent))) {
    return false;
  }
  if (new Set(run.incidents.map((item) => item.id)).size !== run.incidents.length) {
    return false;
  }
  return run.processingStatus !== "COMPLETE" ||
    (run.coverage.processedSamples === run.coverage.expectedSamples && run.coverage.failedSamples === 0);
};

export const perceptionReferencesData = (
  run: PerceptionRun,
  candidates: readonly PerceptionCandidateReference[],
  evidence: readonly PerceptionEvidenceReference[],
): boolean => {
  const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
  if (byIndex.size !== candidates.length) return false;
  for (const incident of run.incidents) {
    const candidate = byIndex.get(incident.candidateIndex);
    if (!candidate || incident.startMs < candidate.startMs || incident.endMs > candidate.endMs) return false;
    for (const index of incident.evidenceIndices) {
      const item = evidence[index];
      if (!item || item.candidateIndex !== incident.candidateIndex ||
        item.startMs < candidate.startMs || item.endMs > candidate.endMs) return false;
    }
  }
  return true;
};
