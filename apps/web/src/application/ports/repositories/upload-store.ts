// 업로드 저장 명령
export type UploadCommand = Readonly<{
  anonymousSessionId: string;
  objectKey: string;
  expectedSizeBytes: number;
  declaredContentType: string;
  competition?: string;
  season?: string;
  rightsConfirmedAt: string;
  expiresAt: string;
  mediaPolicyVersion: string;
}>;

export type UploadIntentResult =
  | Readonly<{ kind: "CREATED"; uploadIntentId: string }>
  | Readonly<{ kind: "SESSION_UNAVAILABLE" }>;

export type UploadIntentStore = Readonly<{
  intent: (command: UploadCommand) => Promise<UploadIntentResult>;
}>;

export type UploadIntentRecord = Readonly<{
  uploadIntentId: string;
  anonymousSessionId: string;
  objectKey: string;
  expectedSizeBytes: number;
  declaredContentType: string;
  competition: string;
  season: string;
  expiresAt: string;
}>;

export type CompletionCommand = Readonly<{
  uploadIntentId: string;
  anonymousSessionId: string;
  objectKey: string;
  sizeBytes: number;
  contentSha256: Uint8Array;
  contentType: "application/octet-stream";
  createdAt: string;
  expiresAt: string;
  mediaPolicyVersion: string;
  validationJobPayloadVersion: number;
  validationMaxAttempts: number;
}>;

export type UploadCompletionResult =
  | Readonly<{ kind: "COMPLETED"; videoAssetId: string }>
  | Readonly<{ kind: "UPLOAD_ALREADY_COMPLETED" }>
  | Readonly<{ kind: "UPLOAD_NOT_FOUND" }>
  | Readonly<{ kind: "UPLOAD_NOT_READY" }>
  | Readonly<{ kind: "UPLOAD_INVALID" }>;

export type UploadCompletionStore = Readonly<{
  owned: (input: Readonly<{
    anonymousSessionId: string;
    uploadIntentId: string;
  }>) => Promise<UploadIntentRecord | null>;
  complete: (command: CompletionCommand) => Promise<UploadCompletionResult>;
}>;
