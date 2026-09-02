import type { Clock } from "../../ports/clock/clock";
import type { CompleteUploadRepository } from "../../ports/repositories/upload-repository";
import type { CompleteUploadStorage } from "../../ports/storage/upload-storage";
import type { UploadPolicy } from "./upload-policy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CompleteUploadInput = Readonly<{
  anonymousSessionId: string;
  uploadIntentId: string;
}>;

export type CompleteUploadResult =
  | Readonly<{ kind: "COMPLETED"; videoAssetId: string }>
  | Readonly<{ kind: "UPLOAD_NOT_FOUND" }>
  | Readonly<{ kind: "UPLOAD_NOT_READY" }>
  | Readonly<{ kind: "UPLOAD_INVALID" }>
  | Readonly<{ kind: "UPLOAD_ALREADY_COMPLETED" }>
  | Readonly<{ kind: "INVALID_INPUT"; reason: "INVALID_ID" }>;

export type CompleteUploadDependencies = Readonly<{
  clock: Clock;
  policy: UploadPolicy;
  storage: CompleteUploadStorage;
  repository: CompleteUploadRepository;
}>;

// 업로드 완료 유스케이스
export const completion =
  ({ clock, policy, storage, repository }: CompleteUploadDependencies) =>
  async (input: CompleteUploadInput): Promise<CompleteUploadResult> => {
    // 세션 식별자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    // 의도 식별자 정규화
    const uploadIntentId = input.uploadIntentId.toLowerCase();
    // 식별자 형식 확인
    if (!UUID_PATTERN.test(anonymousSessionId) || !UUID_PATTERN.test(uploadIntentId)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    // 현재 시각 조회
    const now = clock.now();
    // 완료 시각 계산
    const createdAt = now.toISOString();
    // 소유 의도 조회
    const intent = await repository.owned({ anonymousSessionId, uploadIntentId });
    // 의도 존재 확인
    if (!intent) {
      return { kind: "UPLOAD_NOT_FOUND" };
    }
    // 의도 만료 확인
    if (new Date(intent.expiresAt).getTime() <= now.getTime()) {
      return { kind: "UPLOAD_NOT_READY" };
    }

    // 업로드 객체 확인
    const uploadedObject = await storage.head(intent.objectKey);
    // 업로드 객체 존재 확인
    if (!uploadedObject) {
      return { kind: "UPLOAD_NOT_READY" };
    }
    // 업로드 객체 크기 확인
    if (uploadedObject.sizeBytes !== intent.expectedSizeBytes || uploadedObject.sizeBytes > policy.maxBytes) {
      return { kind: "UPLOAD_INVALID" };
    }

    // 검증 작업 저장
    return repository.complete({
      uploadIntentId,
      anonymousSessionId,
      objectKey: intent.objectKey,
      sizeBytes: uploadedObject.sizeBytes,
      contentSha256: Uint8Array.from(uploadedObject.contentSha256),
      contentType: "application/octet-stream",
      createdAt,
      expiresAt: new Date(now.getTime() + policy.sourceTtlMs).toISOString(),
      mediaPolicyVersion: policy.mediaPolicyVersion,
      validationJobPayloadVersion: policy.validationJobPayloadVersion,
      validationMaxAttempts: policy.validationMaxAttempts,
    });
  };
