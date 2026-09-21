export type AudioObservations = Readonly<{
  version: "audio-observations-v1";
  sourceSha256: string;
  status: "COMPLETE" | "ABSENT" | "UNSUPPORTED" | "FAILED";
  method: "spectral-multitone-v1";
  speechStatus: "NOT_ANALYZED";
  sourceSampleRateHz: number | null;
  sourceChannels: number | null;
  timeline: Readonly<{
    videoOriginSeconds: number | null;
    audioOffsetMs: number | null;
    scannedStartMs: number | null;
    scannedEndMs: number | null;
    decodedFrameCount: number;
    frameDurationMs: 100;
    gapPolicy: "PRESERVED_WITH_SYNTHETIC_SILENCE";
  }>;
  cueCount: number;
  cues: readonly Readonly<{
    id: string;
    startMs: number;
    endMs: number;
    peakFrequenciesHz: readonly number[];
    frameCount: number;
  }>[];
  associations: readonly Readonly<{
    cueId: string;
    candidateIndex: number;
    evidenceIndices: readonly number[];
    relation: "TEMPORAL_OVERLAP_ONLY";
  }>[];
  truncated: boolean;
  reasons: readonly string[];
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const safe = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const signedSafe = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const object = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const audioObservationsData = (
  value: unknown,
  sourceSha256: string,
  sourceDurationMs: number,
): value is AudioObservations => {
  if (!safe(sourceDurationMs) || !object(value, ["version", "sourceSha256", "status", "method", "speechStatus",
    "sourceSampleRateHz", "sourceChannels", "timeline", "cueCount", "cues", "associations", "truncated", "reasons"])) return false;
  if (value.version !== "audio-observations-v1" || value.sourceSha256 !== sourceSha256 ||
    !SHA256.test(sourceSha256) || !["COMPLETE", "ABSENT", "UNSUPPORTED", "FAILED"].includes(value.status as string) ||
    value.method !== "spectral-multitone-v1" || value.speechStatus !== "NOT_ANALYZED" ||
    !(value.sourceSampleRateHz === null || (safe(value.sourceSampleRateHz) && value.sourceSampleRateHz > 0)) ||
    !(value.sourceChannels === null || (safe(value.sourceChannels) && value.sourceChannels >= 1 && value.sourceChannels <= 32)) ||
    !safe(value.cueCount) || typeof value.truncated !== "boolean" || !Array.isArray(value.reasons) ||
    value.reasons.length > 32 || !value.reasons.every((reason) => typeof reason === "string" && reason.length > 0 && reason.length <= 128) ||
    !object(value.timeline, ["videoOriginSeconds", "audioOffsetMs", "scannedStartMs", "scannedEndMs",
      "decodedFrameCount", "frameDurationMs", "gapPolicy"])) return false;

  const timeline = value.timeline;
  if (!(timeline.videoOriginSeconds === null || finite(timeline.videoOriginSeconds)) ||
    !(timeline.audioOffsetMs === null || signedSafe(timeline.audioOffsetMs)) ||
    !(timeline.scannedStartMs === null || (safe(timeline.scannedStartMs) && timeline.scannedStartMs <= sourceDurationMs)) ||
    !(timeline.scannedEndMs === null || (safe(timeline.scannedEndMs) && timeline.scannedEndMs <= sourceDurationMs)) ||
    (timeline.scannedStartMs === null) !== (timeline.scannedEndMs === null) ||
    (typeof timeline.scannedStartMs === "number" && typeof timeline.scannedEndMs === "number" &&
      timeline.scannedEndMs < timeline.scannedStartMs) ||
    !safe(timeline.decodedFrameCount) || timeline.frameDurationMs !== 100 ||
    timeline.gapPolicy !== "PRESERVED_WITH_SYNTHETIC_SILENCE") return false;

  if (!Array.isArray(value.cues) || value.cues.length > 256 || !Array.isArray(value.associations) ||
    value.associations.length > 512 || value.cueCount < value.cues.length ||
    (value.cueCount > value.cues.length && !value.truncated)) return false;
  if (value.status === "ABSENT" && (value.sourceSampleRateHz !== null || value.sourceChannels !== null ||
    timeline.videoOriginSeconds !== null || timeline.audioOffsetMs !== null ||
    timeline.scannedStartMs !== null || timeline.scannedEndMs !== null || timeline.decodedFrameCount !== 0 ||
    value.cueCount !== 0 || value.cues.length !== 0 || value.associations.length !== 0 || value.truncated)) return false;
  if (value.status === "COMPLETE" && (value.sourceSampleRateHz === null || value.sourceChannels === null ||
    timeline.scannedStartMs === null || timeline.scannedEndMs === null)) return false;

  const cueIds = new Set<string>();
  for (const cue of value.cues) {
    if (!object(cue, ["id", "startMs", "endMs", "peakFrequenciesHz", "frameCount"]) ||
      typeof cue.id !== "string" || cue.id.length === 0 || cue.id.length > 96 || cueIds.has(cue.id) ||
      !safe(cue.startMs) || !safe(cue.endMs) || cue.endMs > sourceDurationMs ||
      cue.endMs - cue.startMs < 200 || !safe(cue.frameCount) || cue.frameCount < 2 ||
      !Array.isArray(cue.peakFrequenciesHz) || cue.peakFrequenciesHz.length < 2 || cue.peakFrequenciesHz.length > 3 ||
      !cue.peakFrequenciesHz.every((peak) => finite(peak) && peak >= 3_500 && peak <= 4_500) ||
      (timeline.scannedStartMs !== null && cue.startMs < timeline.scannedStartMs) ||
      (timeline.scannedEndMs !== null && cue.endMs > timeline.scannedEndMs)) return false;
    cueIds.add(cue.id);
  }
  const associations = new Set<string>();
  for (const association of value.associations) {
    if (!object(association, ["cueId", "candidateIndex", "evidenceIndices", "relation"]) ||
      typeof association.cueId !== "string" || !cueIds.has(association.cueId) ||
      !safe(association.candidateIndex) || association.relation !== "TEMPORAL_OVERLAP_ONLY" ||
      !Array.isArray(association.evidenceIndices) || association.evidenceIndices.length < 1 ||
      association.evidenceIndices.length > 16 ||
      !association.evidenceIndices.every(safe) ||
      new Set(association.evidenceIndices).size !== association.evidenceIndices.length) return false;
    const key = `${association.cueId}\u0000${association.candidateIndex}`;
    if (associations.has(key)) return false;
    associations.add(key);
  }
  return true;
};
