import type { Clock } from "../../ports/clock/clock.js";
import type { CreateUploadRepository } from "../../ports/repositories/upload-repository.js";
import type { CreateUploadStorage } from "../../ports/storage/upload-storage.js";
import type { UploadPolicy } from "./upload-policy.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreateUploadInput = Readonly<{
  anonymousSessionId: string;
  expectedSizeBytes: number;
  declaredContentType: string;
  rightsConfirmed: boolean;
}>;

export type CreateUploadResult =
  | Readonly<{
      kind: "CREATED";
      uploadIntentId: string;
      objectKey: string;
      uploadUrl: string;
      expiresAt: string;
    }>
  | Readonly<{ kind: "INVALID_INPUT"; reason: "INVALID_ID" | "INVALID_SIZE" }>
  | Readonly<{ kind: "INVALID_SIZE" }>
  | Readonly<{ kind: "UNSUPPORTED_CONTENT_TYPE" }>
  | Readonly<{ kind: "RIGHTS_NOT_CONFIRMED" }>
  | Readonly<{ kind: "SESSION_UNAVAILABLE" }>;

export type CreateUploadDependencies = Readonly<{
  clock: Clock;
  policy: UploadPolicy;
  storage: CreateUploadStorage;
  repository: CreateUploadRepository;
}>;

export const upload =
  ({ clock, policy, storage, repository }: CreateUploadDependencies) =>
  async (input: CreateUploadInput): Promise<CreateUploadResult> => {
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    if (!UUID_PATTERN.test(anonymousSessionId)) {
      return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
    }

    if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
      return { kind: "INVALID_INPUT", reason: "INVALID_SIZE" };
    }

    if (input.expectedSizeBytes > policy.maxBytes) {
      return { kind: "INVALID_SIZE" };
    }

    if (!policy.allowedContentTypes.includes(input.declaredContentType)) {
      return { kind: "UNSUPPORTED_CONTENT_TYPE" };
    }

    if (!input.rightsConfirmed) {
      return { kind: "RIGHTS_NOT_CONFIRMED" };
    }

    const now = clock.now();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + policy.uploadIntentTtlMs).toISOString();
    const grant = await storage.grant({
      anonymousSessionId,
      expectedSizeBytes: input.expectedSizeBytes,
      contentType: input.declaredContentType,
      expiresAt,
    });
    let persisted: Awaited<ReturnType<CreateUploadRepository["intent"]>>;
    try {
      persisted = await repository.intent({
        anonymousSessionId,
        objectKey: grant.objectKey,
        expectedSizeBytes: input.expectedSizeBytes,
        declaredContentType: input.declaredContentType,
        rightsConfirmedAt: createdAt,
        expiresAt,
        mediaPolicyVersion: policy.mediaPolicyVersion,
      });
    } catch (error) {
      await storage.cleanup(grant.objectKey);
      throw error;
    }

    if (persisted.kind !== "CREATED") {
      await storage.cleanup(grant.objectKey);
      return persisted;
    }

    return {
      kind: "CREATED",
      uploadIntentId: persisted.uploadIntentId,
      objectKey: grant.objectKey,
      uploadUrl: grant.uploadUrl,
      expiresAt: grant.expiresAt,
    };
  };

export const createUpload = upload;
