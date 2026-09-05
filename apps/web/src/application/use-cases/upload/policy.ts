// 업로드 정책
export type UploadPolicy = Readonly<{
  maxBytes: number;
  allowedContentTypes: readonly string[];
  uploadIntentTtlMs: number;
  sourceTtlMs: number;
  mediaPolicyVersion: string;
  validationJobPayloadVersion: number;
  validationMaxAttempts: number;
}>;
