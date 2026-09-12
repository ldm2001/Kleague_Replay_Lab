import type { Clock } from "../../ports/clock/clock";
// 모델 관찰 출력 검증
import { observationData, perceptionReferencesData, perceptionRunData } from "@replay/shared-types";
import { perceptionAdmission } from "@replay/rule-engine";
import { trackingData } from "@replay/shared-types";
import { sceneEventData } from "@replay/shared-types";
import { broadcastCueData } from "@replay/shared-types";
import type { Hasher } from "../../ports/hashing/hasher";
import type {
  AnalysisCandidate,
  AnalysisEvidence,
  AnalysisPayload,
  AnalysisShot,
  JobFailurePayload,
  JobResult,
  JobResultPayload,
  JobResultStore,
  ValidationPayload,
} from "../../ports/repositories/job-store";
import type { CompletionStorage } from "../../ports/storage/upload-storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9_]{1,64}$/;

// 작업 결과 입력
export type ResultInput = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseToken: string;
  payload: JobResultPayload;
}>;

export type ResultInvalidReason =
  | "JOB_ID"
  | "WORKER_ID"
  | "REVISION"
  | "LEASE"
  | "PAYLOAD";

export type ResultResult = JobResult | Readonly<{
  kind: "INVALID_INPUT";
  reason: ResultInvalidReason;
}> | Readonly<{
  kind: "INVALID_RESULT";
  reason: "VERIFICATION_UNAVAILABLE" | "SOURCE" | "ARTIFACT" | "REFERENCE" | "STORAGE";
}>;

export type ResultDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: JobResultStore;
  storage?: CompletionStorage;
}>;

const bytesHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

const verifiedHash = (value: Uint8Array, expected: string): boolean =>
  value.length === 32 && bytesHex(value) === expected;

const MAX_PERCEPTION_OBJECT_BYTES = 128 * 1_024 * 1_024;
const MAX_REFERENCE_OBJECT_BYTES = 50 * 1_024 * 1_024;

// 영상 검증 payload 확인
const validation = (payload: ValidationPayload): boolean =>
  Number.isSafeInteger(payload.durationMs) &&
  payload.durationMs > 0 &&
  Number.isSafeInteger(payload.width) &&
  payload.width > 0 &&
  Number.isSafeInteger(payload.height) &&
  payload.height > 0;

// Worker 실패 payload 확인
const failure = (payload: JobFailurePayload): boolean =>
  CODE.test(payload.failureCode) && typeof payload.retryable === "boolean";

// 샷 payload 확인
const shot = (value: AnalysisShot): boolean =>
  Number.isSafeInteger(value.index) &&
  value.index >= 0 &&
  Number.isSafeInteger(value.startMs) &&
  value.startMs >= 0 &&
  Number.isSafeInteger(value.endMs) &&
  value.endMs >= value.startMs &&
  ["NORMAL", "SLOW", "UNKNOWN"].includes(value.playbackSpeed) &&
  typeof value.isReplay === "boolean" &&
  (value.cameraAngle === null || typeof value.cameraAngle === "string");

// 후보 payload 확인
const candidate = (value: AnalysisCandidate): boolean =>
  Number.isSafeInteger(value.index) &&
  value.index >= 0 &&
  value.category === "OTHER" &&
  Number.isSafeInteger(value.startMs) &&
  value.startMs >= 0 &&
  Number.isSafeInteger(value.endMs) &&
  value.endMs >= value.startMs &&
  Number.isSafeInteger(value.anchorMs) &&
  value.anchorMs >= value.startMs &&
  value.anchorMs <= value.endMs &&
  Number.isFinite(value.confidence) &&
  value.confidence >= 0 &&
  value.confidence <= 1 &&
  ["LOW", "MEDIUM", "HIGH"].includes(value.cameraSufficiency) &&
  Array.isArray(value.reasons) &&
  value.reasons.every((reason) => typeof reason === "string") &&
  Array.isArray(value.shotIndices) &&
  value.shotIndices.every((index) => Number.isSafeInteger(index) && index >= 0) &&
  (value.tracking == null || trackingData(value.tracking, value.startMs, value.endMs)) &&
  // 재개 상황의 시각과 근거는 제출된 후보 구간 안에 있어야 한다
  (value.sceneEvent == null || sceneEventData(value.sceneEvent, value.startMs, value.endMs)) &&
  (value.broadcastCue == null || broadcastCueData(value.broadcastCue, value.startMs, value.endMs)) &&
  // 모델 관찰과 프레임 시각은 후보 구간 안에서만 허용
  (value.observation == null || (observationData(value.observation) &&
    value.observation.timestamps.every((time) => time >= value.startMs && time <= value.endMs)));

// 증거 payload 확인
const evidence = (value: AnalysisEvidence): boolean =>
  Number.isSafeInteger(value.candidateIndex) &&
  value.candidateIndex >= 0 &&
  ["FRAME", "CLIP"].includes(value.kind) &&
  /^evidence\/[0-9a-f-]+\/[0-9a-f-]+\/[A-Za-z0-9._-]+$/i.test(value.objectKey) &&
  /^[a-f0-9]{64}$/i.test(value.contentSha256) &&
  Number.isSafeInteger(value.startMs) &&
  value.startMs >= 0 &&
  Number.isSafeInteger(value.endMs) &&
  value.endMs >= value.startMs &&
  (value.width === null || (Number.isSafeInteger(value.width) && value.width > 0)) &&
  (value.height === null || (Number.isSafeInteger(value.height) && value.height > 0));

// 분석 payload 확인
const analysis = (value: AnalysisPayload): boolean => {
  const valid = typeof value.pipelineVersion === "string" &&
    value.pipelineVersion.length > 0 &&
    value.pipelineVersion.length <= 64 &&
    Array.isArray(value.limitations) &&
    value.limitations.every((item) => typeof item === "string") &&
    Array.isArray(value.shots) &&
    value.shots.every(shot) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(candidate) &&
    (value.evidence === undefined || (
      Array.isArray(value.evidence) &&
      value.evidence.length <= 128 &&
      value.evidence.every(evidence)
    ));
  if (!valid) return false;
  if (value.pipelineVersion !== "video-local-observers-v1") return value.perception === undefined;
  if (new Set(value.shots.map((item) => item.index)).size !== value.shots.length ||
    new Set(value.candidates.map((item) => item.index)).size !== value.candidates.length ||
    new Set((value.evidence ?? []).map((item) => item.objectKey)).size !== (value.evidence ?? []).length) {
    return false;
  }
  return perceptionRunData(value.perception) && perceptionReferencesData(
    value.perception,
    value.candidates,
    value.evidence ?? [],
  );
};

// 결과 유형별 payload 확인
const payload = (value: JobResultPayload): boolean =>
  value.kind === "VALIDATED"
    ? validation(value)
    : value.kind === "ANALYZED"
      ? analysis(value)
      : value.kind === "FAILED" && failure(value);

export const result =
  ({ clock, hasher, repository, storage }: ResultDependencies) =>
  async (input: ResultInput): Promise<ResultResult> => {
    // 작업 결과 검증
    if (!UUID.test(input.jobId)) {
      return { kind: "INVALID_INPUT", reason: "JOB_ID" };
    }

    const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
    if (workerId.length === 0 || workerId.length > 128) {
      return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
    }

    if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
      return { kind: "INVALID_INPUT", reason: "REVISION" };
    }

    if (typeof input.leaseToken !== "string" || input.leaseToken.trim().length === 0) {
      return { kind: "INVALID_INPUT", reason: "LEASE" };
    }

    if (!payload(input.payload)) {
      return { kind: "INVALID_INPUT", reason: "PAYLOAD" };
    }

    // Lease 토큰 해시 생성
    const leaseTokenHash = Uint8Array.from(await hasher.sha256(input.leaseToken));
    if (input.payload.kind === "ANALYZED" && input.payload.pipelineVersion === "video-local-observers-v1") {
      if (!input.payload.perception || !repository.preflight || !storage) {
        return { kind: "INVALID_RESULT", reason: "VERIFICATION_UNAVAILABLE" };
      }
      const initialNow = clock.now().toISOString();
      const preflight = await repository.preflight({
        jobId: input.jobId.toLowerCase(),
        workerId,
        jobRevision: input.jobRevision,
        leaseTokenHash,
        now: initialNow,
      });
      if (preflight.kind !== "AUTHORIZED") return preflight;
      const perception = input.payload.perception;
      if (!verifiedHash(preflight.sourceSha256, perception.sourceSha256) ||
        !verifiedHash(preflight.analysisSourceSha256, perception.sourceSha256) || !preflight.expiresAt) {
        return { kind: "INVALID_RESULT", reason: "SOURCE" };
      }
      const expectedArtifactKey = `perception/${preflight.analysisId}/${input.jobId.toLowerCase()}/${input.jobRevision}/${perception.artifact.contentSha256}.jsonl.gz`;
      if (perception.artifact.objectKey !== expectedArtifactKey) {
        return { kind: "INVALID_RESULT", reason: "ARTIFACT" };
      }
      try {
        const artifact = await storage.head(perception.artifact.objectKey, MAX_PERCEPTION_OBJECT_BYTES);
        if (!artifact || artifact.sizeBytes !== perception.artifact.sizeBytes ||
          !verifiedHash(artifact.contentSha256, perception.artifact.contentSha256)) {
          return { kind: "INVALID_RESULT", reason: "ARTIFACT" };
        }
        const evidence = input.payload.evidence ?? [];
        const indices = [...new Set(perception.incidents.flatMap((incident) => incident.evidenceIndices))];
        const references = await Promise.all(indices.map(async (evidenceIndex) => {
          const item = evidence[evidenceIndex]!;
          const expectedPrefix = `evidence/${preflight.analysisId}/${input.jobId.toLowerCase()}/`;
          if (!item.objectKey.startsWith(expectedPrefix)) return null;
          const object = await storage.head(item.objectKey, MAX_REFERENCE_OBJECT_BYTES);
          if (!object || !verifiedHash(object.contentSha256, item.contentSha256)) return null;
          return {
            evidenceIndex,
            candidateIndex: item.candidateIndex,
            startMs: item.startMs,
            endMs: item.endMs,
            declaredContentSha256: item.contentSha256.toLowerCase(),
            verifiedContentSha256: bytesHex(object.contentSha256),
          };
        }));
        if (references.some((reference) => reference === null)) {
          return { kind: "INVALID_RESULT", reason: "REFERENCE" };
        }
        const admission = perceptionAdmission(perception, {
          serverVerified: true,
          pipelineVersion: input.payload.pipelineVersion,
          sourceSha256: bytesHex(preflight.sourceSha256),
          artifact: {
            objectKey: perception.artifact.objectKey,
            contentSha256: bytesHex(artifact.contentSha256),
            sizeBytes: artifact.sizeBytes,
          },
          references: references.filter((reference) => reference !== null),
          ruleEdition: preflight.ruleEdition,
        });
        const completedAt = clock.now();
        if (!Number.isFinite(new Date(preflight.expiresAt).getTime()) ||
          new Date(preflight.expiresAt).getTime() <= completedAt.getTime()) {
          return { kind: "INVALID_RESULT", reason: "SOURCE" };
        }
        return repository.result({
          jobId: input.jobId.toLowerCase(),
          workerId,
          jobRevision: input.jobRevision,
          leaseTokenHash,
          now: completedAt.toISOString(),
          payload: input.payload,
          perceptionVerification: {
            analysisId: preflight.analysisId,
            sourceSha256: preflight.sourceSha256,
            admission,
          },
        });
      } catch {
        return { kind: "INVALID_RESULT", reason: "STORAGE" };
      }
    }

    // 작업 결과 저장
    return repository.result({
      jobId: input.jobId.toLowerCase(),
      workerId,
      jobRevision: input.jobRevision,
      leaseTokenHash,
      now: clock.now().toISOString(),
      payload: input.payload,
    });
  };
