// 영상과 세션 정책
import type { SessionPolicy, UploadPolicy } from "@replay/application";

export const mediaPolicy: UploadPolicy = Object.freeze({
  maxBytes: 2 * 1024 * 1024 * 1024,
  allowedContentTypes: Object.freeze(["video/mp4", "video/quicktime", "video/webm"]),
  uploadIntentTtlMs: 15 * 60 * 1000,
  sourceTtlMs: 24 * 60 * 60 * 1000,
  mediaPolicyVersion: "media-v1",
  validationJobPayloadVersion: 1,
  validationMaxAttempts: 3,
});

export const sessionPolicy: SessionPolicy = Object.freeze({ ttlMs: 24 * 60 * 60 * 1000 });
