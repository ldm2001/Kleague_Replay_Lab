import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type {
  AnalysisCommand,
  AnalysisStore,
  AnalysisResult,
} from "../../ports/repositories/analysis-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_BYTES = 200;

export type AnalysisInput = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  matchId: string;
  idempotencyKey: string;
  sourceUrl?: string;
  sourcePlatform?: string;
}>;

export type AnalysisPolicy = Readonly<{
  retentionMs: number;
  pipelineVersion: string;
  mediaPolicyVersion: string;
  jobPayloadVersion: number;
  maxJobAttempts: number;
}>;

export type AnalysisError =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_TOO_LONG"
  | "INVALID_ID";

export type AnalysisOutcome =
  | AnalysisResult
  | Readonly<{
      kind: "INVALID_INPUT";
      reason: AnalysisError;
    }>;

export type AnalysisDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: AnalysisStore;
  policy: AnalysisPolicy;
}>;

// 선택 문자열 정규화
const optionalText = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

// 식별자 형식 확인
const validIds = (
  input: Pick<AnalysisInput, "anonymousSessionId" | "videoAssetId" | "matchId">,
): boolean =>
  UUID_PATTERN.test(input.anonymousSessionId) &&
  UUID_PATTERN.test(input.videoAssetId) &&
  UUID_PATTERN.test(input.matchId);

// 멱등 키 확인
const idempotencyKey = (
  idempotencyKey: string,
): AnalysisError | null => {
  const byteLength = new TextEncoder().encode(idempotencyKey).byteLength;

  if (byteLength === 0) {
    return "IDEMPOTENCY_KEY_REQUIRED";
  }

  if (byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
    return "IDEMPOTENCY_KEY_TOO_LONG";
  }

  return null;
};

// 분석 제출 유스케이스
export const analysis =
  ({ clock, hasher, repository, policy }: AnalysisDependencies) =>
  async (input: AnalysisInput): Promise<AnalysisOutcome> => {
    // 입력과 정책 스냅샷 생성
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

    // 식별자 형식 확인
    if (!validIds(snapshot)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    // 멱등 키 형식 확인
    const idempotencyKeyError = idempotencyKey(snapshot.idempotencyKey);
    if (idempotencyKeyError !== null) {
      return { kind: "INVALID_INPUT", reason: idempotencyKeyError };
    }

    // 식별자 소문자 정규화
    const anonymousSessionId = snapshot.anonymousSessionId.toLowerCase();
    const videoAssetId = snapshot.videoAssetId.toLowerCase();
    const matchId = snapshot.matchId.toLowerCase();
    // 선택 문자열 정규화
    const sourceUrl = optionalText(snapshot.sourceUrl);
    const sourcePlatform = optionalText(snapshot.sourcePlatform);
    // 요청 해시 입력 구성
    const requestHashInput = JSON.stringify({
      anonymousSessionId,
      videoAssetId,
      matchId,
      sourceUrl,
      sourcePlatform,
      pipelineVersion: snapshot.pipelineVersion,
      mediaPolicyVersion: snapshot.mediaPolicyVersion,
    });
    // 멱등 키 해시 생성
    const keyHash = Uint8Array.from(await hasher.sha256(snapshot.idempotencyKey));
    // 요청 내용 해시 생성
    const requestHash = Uint8Array.from(await hasher.sha256(requestHashInput));
    // 현재 시각 조회
    const now = clock.now();

    // 분석 제출 명령 구성
    const command: AnalysisCommand = {
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

    // 분석 저장소 호출
    return repository.submission(command);
  };
