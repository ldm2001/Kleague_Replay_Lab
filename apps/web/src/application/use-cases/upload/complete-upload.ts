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

export const completion =
  ({ clock, policy, storage, repository }: CompleteUploadDependencies) =>
  async (input: CompleteUploadInput): Promise<CompleteUploadResult> => {
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    const uploadIntentId = input.uploadIntentId.toLowerCase();
    if (!UUID_PATTERN.test(anonymousSessionId) || !UUID_PATTERN.test(uploadIntentId)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    const now = clock.now();
    const createdAt = now.toISOString();
    const intent = await repository.owned({ anonymousSessionId, uploadIntentId });
    if (!intent) {
      return { kind: "UPLOAD_NOT_FOUND" };
    }
    if (new Date(intent.expiresAt).getTime() <= now.getTime()) {
      return { kind: "UPLOAD_NOT_READY" };
    }

    const uploadedObject = await storage.head(intent.objectKey);
    if (!uploadedObject) {
      return { kind: "UPLOAD_NOT_READY" };
    }
    if (uploadedObject.sizeBytes !== intent.expectedSizeBytes || uploadedObject.sizeBytes > policy.maxBytes) {
      return { kind: "UPLOAD_INVALID" };
    }

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
