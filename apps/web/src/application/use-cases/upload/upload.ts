import type { Clock } from "../../ports/clock/clock";
import type { UploadIntentStore } from "../../ports/repositories/upload-store";
import type { UploadStorage } from "../../ports/storage/upload-storage";
import type { UploadPolicy } from "./policy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPETITIONS = new Set(["K리그1", "K리그2"]);
const SEASONS = new Set(["2026"]);

export type UploadInput = Readonly<{
  anonymousSessionId: string;
  expectedSizeBytes: number;
  declaredContentType: string;
  rightsConfirmed: boolean;
  competition?: string;
  season?: string;
}>;

export type UploadResult =
  | Readonly<{
      kind: "CREATED";
      uploadIntentId: string;
      objectKey: string;
      uploadUrl: string;
      expiresAt: string;
    }>
  | Readonly<{ kind: "INVALID_INPUT"; reason: "INVALID_ID" | "INVALID_SIZE" | "COMPETITION" }>
  | Readonly<{ kind: "INVALID_SIZE" }>
  | Readonly<{ kind: "UNSUPPORTED_CONTENT_TYPE" }>
  | Readonly<{ kind: "RIGHTS_NOT_CONFIRMED" }>
  | Readonly<{ kind: "SESSION_UNAVAILABLE" }>;

export type UploadDependencies = Readonly<{
  clock: Clock;
  policy: UploadPolicy;
  storage: UploadStorage;
  repository: UploadIntentStore;
}>;

// 업로드 생성 유스케이스
export const upload =
  ({ clock, policy, storage, repository }: UploadDependencies) =>
  async (input: UploadInput): Promise<UploadResult> => {
    // 세션 식별자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    // 세션 식별자 확인
    if (!UUID_PATTERN.test(anonymousSessionId)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    const competition = input.competition?.trim() || "K리그1";
    const season = input.season?.trim() || "2026";
    if (!COMPETITIONS.has(competition) || !SEASONS.has(season)) {
      return { kind: "INVALID_INPUT", reason: "COMPETITION" };
    }

    // 업로드 크기 형식 확인
    if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
      return { kind: "INVALID_INPUT", reason: "INVALID_SIZE" };
    }

    // 업로드 크기 제한 확인
    if (input.expectedSizeBytes > policy.maxBytes) {
      return { kind: "INVALID_SIZE" };
    }

    // 콘텐츠 형식 확인
    if (!policy.allowedContentTypes.includes(input.declaredContentType)) {
      return { kind: "UNSUPPORTED_CONTENT_TYPE" };
    }

    // 권리 확인 상태 확인
    if (!input.rightsConfirmed) {
      return { kind: "RIGHTS_NOT_CONFIRMED" };
    }

    // 현재 시각 조회
    const now = clock.now();
    // 의도 생성 시각 계산
    const createdAt = now.toISOString();
    // 의도 만료 시각 계산
    const expiresAt = new Date(now.getTime() + policy.uploadIntentTtlMs).toISOString();
    // 저장소 업로드 권한 발급
    const grant = await storage.grant({
      anonymousSessionId,
      expectedSizeBytes: input.expectedSizeBytes,
      contentType: input.declaredContentType,
      expiresAt,
    });
    // 업로드 의도 저장
    let persisted: Awaited<ReturnType<UploadIntentStore["intent"]>>;
    try {
      persisted = await repository.intent({
        anonymousSessionId,
        objectKey: grant.objectKey,
        expectedSizeBytes: input.expectedSizeBytes,
        declaredContentType: input.declaredContentType,
        competition,
        season,
        rightsConfirmedAt: createdAt,
        expiresAt,
        mediaPolicyVersion: policy.mediaPolicyVersion,
      });
    } catch (error) {
      // 저장 오류 보상 삭제
      await storage.cleanup(grant.objectKey);
      throw error;
    }

    if (persisted.kind !== "CREATED") {
      // 저장 실패 보상 삭제
      await storage.cleanup(grant.objectKey);
      return persisted;
    }

    // 업로드 결과 반환
    return {
      kind: "CREATED",
      uploadIntentId: persisted.uploadIntentId,
      objectKey: grant.objectKey,
      uploadUrl: grant.uploadUrl,
      expiresAt: grant.expiresAt,
    };
  };
