import type { PerceptionModelComponent, PerceptionModelProvenance, PerceptionRun } from "@replay/shared-types";
import detectorManifest from "../../../../../experiments/perception/src/replay_perception/model-manifest.json";
import observerManifest from "../../../../../experiments/perception/src/replay_perception/observer-models.json";

export type VerifiedPerceptionReference = Readonly<{
  evidenceIndex: number;
  candidateIndex: number;
  startMs: number;
  endMs: number;
  declaredContentSha256: string;
  verifiedContentSha256: string;
}>;

export type PerceptionAdmissionContext = Readonly<{
  serverVerified: boolean;
  pipelineVersion: string;
  sourceSha256: string;
  artifact: Readonly<{ objectKey: string; contentSha256: string; sizeBytes: number }>;
  references: readonly VerifiedPerceptionReference[];
  ruleEdition: Readonly<{
    id: string;
    verificationStatus: string;
    matchId: string;
    ifabEdition: string;
  }> | null;
}>;

export type PerceptionAdmission = Readonly<{
  status: "NOT_ADMITTED";
  reasons: readonly string[];
}>;

const fileHash = (files: readonly Readonly<{ name: string; sha256: string }>[], name: string): string => {
  const file = files.find((item) => item.name === name);
  if (!file) throw new Error(`Pinned model file is unavailable: ${name}`);
  return file.sha256;
};

// 서버 저장소의 고정 manifest만 신뢰하며 Worker가 보낸 승인 플래그는 입력으로 받지 않는다
export const perceptionModelPins: Readonly<Record<PerceptionModelComponent, PerceptionModelProvenance>> = Object.freeze({
  detector: Object.freeze({
    component: "detector",
    modelId: detectorManifest.model_id,
    revision: detectorManifest.revision,
    weightsSha256: fileHash(detectorManifest.files, "model.safetensors"),
  }),
  role: Object.freeze({
    component: "role",
    modelId: observerManifest.models.role.model_id,
    revision: observerManifest.models.role.revision,
    weightsSha256: fileHash(observerManifest.models.role.files, "yolo-football-player-detection.pt"),
  }),
  pose: Object.freeze({
    component: "pose",
    modelId: observerManifest.models.pose.model_id,
    revision: observerManifest.models.pose.revision,
    weightsSha256: fileHash(observerManifest.models.pose.files, "model.safetensors"),
  }),
});

type RecognitionMethod = "role" | "signal" | "contact" | "foul" | "originalDecision" | "restart";
type RecognitionMethodState = "VERIFIED" | "NOT_VERIFIED";

export const perceptionRecognitionMethods: Readonly<Record<RecognitionMethod, RecognitionMethodState>> = Object.freeze({
  role: "NOT_VERIFIED",
  signal: "NOT_VERIFIED",
  contact: "NOT_VERIFIED",
  foul: "NOT_VERIFIED",
  originalDecision: "NOT_VERIFIED",
  restart: "NOT_VERIFIED",
});

const methodReasons = {
  role: "ROLE_METHOD_NOT_VERIFIED",
  signal: "SIGNAL_METHOD_NOT_VERIFIED",
  contact: "CONTACT_METHOD_NOT_VERIFIED",
  foul: "FOUL_METHOD_NOT_VERIFIED",
  originalDecision: "ORIGINAL_DECISION_METHOD_NOT_VERIFIED",
  restart: "RESTART_METHOD_NOT_VERIFIED",
} as const;

const sameModel = (actual: PerceptionModelProvenance, expected: PerceptionModelProvenance): boolean =>
  actual.component === expected.component && actual.modelId === expected.modelId &&
  actual.revision === expected.revision && actual.weightsSha256 === expected.weightsSha256;

const relevant = (startMs: number, endMs: number, incidentStartMs: number, incidentEndMs: number): boolean =>
  startMs === endMs
    ? startMs >= incidentStartMs && startMs <= incidentEndMs
    : startMs < incidentEndMs && endMs > incidentStartMs;

export const perceptionAdmission = (
  run: PerceptionRun,
  context: PerceptionAdmissionContext,
): PerceptionAdmission => {
  const reasons: string[] = [];
  if (!context.serverVerified) reasons.push("SERVER_CONTEXT_UNVERIFIED");
  if (context.pipelineVersion !== "video-local-observers-v1") reasons.push("PIPELINE_VERSION_UNVERIFIED");
  if (run.processingStatus !== "COMPLETE") reasons.push("PROCESSING_NOT_COMPLETE");
  if (run.summary.truncated) reasons.push("SUMMARY_TRUNCATED");
  if (context.sourceSha256 !== run.sourceSha256) reasons.push("SOURCE_HASH_UNVERIFIED");
  if (context.artifact.objectKey !== run.artifact.objectKey ||
    context.artifact.contentSha256 !== run.artifact.contentSha256 ||
    context.artifact.sizeBytes !== run.artifact.sizeBytes) {
    reasons.push("ARTIFACT_UNVERIFIED");
  }
  for (const component of ["detector", "role", "pose"] as const) {
    const actual = run.models.find((item) => item.component === component);
    if (!actual || !sameModel(actual, perceptionModelPins[component])) {
      reasons.push(`MODEL_PROVENANCE_UNPINNED:${component}`);
    }
  }
  if (!context.ruleEdition || context.ruleEdition.verificationStatus !== "VERIFIED" ||
    typeof context.ruleEdition.matchId !== "string" || context.ruleEdition.matchId.length === 0 ||
    typeof context.ruleEdition.ifabEdition !== "string" || context.ruleEdition.ifabEdition.length === 0) {
    reasons.push("RULE_EDITION_UNVERIFIED");
  }

  const references = new Map(context.references.map((item) => [item.evidenceIndex, item]));
  for (const incident of run.incidents) {
    if (incident.startMs < run.coverage.startMs || incident.endMs > run.coverage.endMs) {
      reasons.push(`RUN_COVERAGE_INSUFFICIENT:${incident.id}`);
    }
    let covered = false;
    for (const index of incident.evidenceIndices) {
      const reference = references.get(index);
      if (!reference) {
        reasons.push(`REFERENCE_MISSING:${index}`);
        continue;
      }
      if (reference.candidateIndex !== incident.candidateIndex) {
        reasons.push(`REFERENCE_CANDIDATE_MISMATCH:${index}`);
      }
      if (reference.declaredContentSha256 !== reference.verifiedContentSha256) {
        reasons.push(`REFERENCE_HASH_UNVERIFIED:${index}`);
      }
      if (reference.candidateIndex === incident.candidateIndex &&
        relevant(reference.startMs, reference.endMs, incident.startMs, incident.endMs)) {
        covered = true;
      }
    }
    if (!covered) reasons.push(`REFERENCE_COVERAGE_INSUFFICIENT:${incident.id}`);
    if (incident.officialRole === "UNKNOWN") reasons.push(`OFFICIAL_ROLE_UNKNOWN:${incident.id}`);
    if (incident.signal === "UNKNOWN") reasons.push(`SIGNAL_UNKNOWN:${incident.id}`);
  }

  // 닫힌 서버 registry: 저장 무결성은 영상 의미의 검증이나 규정 사실 승인이 아니다
  for (const method of Object.keys(perceptionRecognitionMethods) as RecognitionMethod[]) {
    if (perceptionRecognitionMethods[method] !== "VERIFIED") reasons.push(methodReasons[method]);
  }
  return { status: "NOT_ADMITTED", reasons: [...new Set(reasons)] };
};
