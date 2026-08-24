import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type {
  SubmitAnalysisCommand,
  SubmitAnalysisRepository,
  SubmitAnalysisRepositoryResult,
} from "../../ports/repositories/submit-analysis-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_BYTES = 200;

export type SubmitAnalysisInput = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  matchId: string;
  idempotencyKey: string;
  sourceUrl?: string;
  sourcePlatform?: string;
}>;

export type SubmitAnalysisPolicy = Readonly<{
  retentionMs: number;
  pipelineVersion: string;
  mediaPolicyVersion: string;
  jobPayloadVersion: number;
  maxJobAttempts: number;
}>;

export type SubmitAnalysisInvalidInputReason =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_TOO_LONG"
  | "INVALID_ID";

export type SubmitAnalysisResult =
  | SubmitAnalysisRepositoryResult
  | Readonly<{
      kind: "INVALID_INPUT";
      reason: SubmitAnalysisInvalidInputReason;
    }>;

export type SubmitAnalysisDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: SubmitAnalysisRepository;
  policy: SubmitAnalysisPolicy;
}>;

const normalizeOptionalString = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

const hasValidIds = (
  input: Pick<SubmitAnalysisInput, "anonymousSessionId" | "videoAssetId" | "matchId">,
): boolean =>
  UUID_PATTERN.test(input.anonymousSessionId) &&
  UUID_PATTERN.test(input.videoAssetId) &&
  UUID_PATTERN.test(input.matchId);

const validateIdempotencyKey = (
  idempotencyKey: string,
): SubmitAnalysisInvalidInputReason | null => {
  const byteLength = new TextEncoder().encode(idempotencyKey).byteLength;

  if (byteLength === 0) {
    return "IDEMPOTENCY_KEY_REQUIRED";
  }

  if (byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
    return "IDEMPOTENCY_KEY_TOO_LONG";
  }

  return null;
};

export const submit =
  ({ clock, hasher, repository, policy }: SubmitAnalysisDependencies) =>
  async (input: SubmitAnalysisInput): Promise<SubmitAnalysisResult> => {
    const snapshot = {
      anonymousSessionId: input.anonymousSessionId,
      videoAssetId: input.videoAssetId,
      matchId: input.matchId,
      idempotencyKey: input.idempotencyKey,
      sourceUrl: input.sourceUrl,
      sourcePlatform: input.sourcePlatform,
      retentionMs: policy.retentionMs,
      pipelineVersion: policy.pipelineVersion,
      mediaPolicyVersion: policy.mediaPolicyVersion,
      jobPayloadVersion: policy.jobPayloadVersion,
      maxJobAttempts: policy.maxJobAttempts,
    };

    if (!hasValidIds(snapshot)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    const idempotencyKeyError = validateIdempotencyKey(snapshot.idempotencyKey);
    if (idempotencyKeyError !== null) {
      return { kind: "INVALID_INPUT", reason: idempotencyKeyError };
    }

    const anonymousSessionId = snapshot.anonymousSessionId.toLowerCase();
    const videoAssetId = snapshot.videoAssetId.toLowerCase();
    const matchId = snapshot.matchId.toLowerCase();
    const sourceUrl = normalizeOptionalString(snapshot.sourceUrl);
    const sourcePlatform = normalizeOptionalString(snapshot.sourcePlatform);
    const requestHashInput = JSON.stringify({
      anonymousSessionId,
      videoAssetId,
      matchId,
      sourceUrl,
      sourcePlatform,
      pipelineVersion: snapshot.pipelineVersion,
      mediaPolicyVersion: snapshot.mediaPolicyVersion,
    });
    const keyHash = Uint8Array.from(await hasher.sha256(snapshot.idempotencyKey));
    const requestHash = Uint8Array.from(await hasher.sha256(requestHashInput));
    const now = clock.now();

    const command: SubmitAnalysisCommand = {
      anonymousSessionId,
      videoAssetId,
      matchId,
      sourceUrl,
      sourcePlatform,
      keyHash,
      requestHash,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + snapshot.retentionMs).toISOString(),
      pipelineVersion: snapshot.pipelineVersion,
      mediaPolicyVersion: snapshot.mediaPolicyVersion,
      jobPayloadVersion: snapshot.jobPayloadVersion,
      maxJobAttempts: snapshot.maxJobAttempts,
    };

    return repository.submit(command);
  };

export const createSubmitAnalysis = submit;
