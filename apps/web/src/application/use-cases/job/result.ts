import type { Clock } from "../../ports/clock/clock";
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
}>;

export type ResultDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: JobResultStore;
}>;

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
  value.shotIndices.every((index) => Number.isSafeInteger(index) && index >= 0);

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
const analysis = (value: AnalysisPayload): boolean =>
  typeof value.pipelineVersion === "string" &&
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

// 결과 유형별 payload 확인
const payload = (value: JobResultPayload): boolean =>
  value.kind === "VALIDATED"
    ? validation(value)
    : value.kind === "ANALYZED"
      ? analysis(value)
      : value.kind === "FAILED" && failure(value);

export const result =
  ({ clock, hasher, repository }: ResultDependencies) =>
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
