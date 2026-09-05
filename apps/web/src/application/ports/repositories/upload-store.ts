// 업로드 저장 명령
// 업로드 의도 입력
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

// 업로드 의도 저장 포트
export type UploadIntentStore = Readonly<{
  intent: (command: UploadCommand) => Promise<UploadIntentResult>;
}>;

// 업로드 의도 조회 모델
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

// 업로드 완료 저장 입력
export type CompletionCommand = Readonly<{
  uploadIntentId: string;
  anonymousSessionId: string;
  objectKey: string;
  sizeBytes: number;
  contentSha256: Uint8Array;
  contentType: string;
  createdAt: string;
  expiresAt: string;
  mediaPolicyVersion: string;
  validationJobPayloadVersion: number;
  validationMaxAttempts: number;
}>;

// 업로드 완료 결과
export type UploadCompletionResult =
  | Readonly<{ kind: "COMPLETED"; videoAssetId: string }>
  | Readonly<{ kind: "UPLOAD_ALREADY_COMPLETED" }>
  | Readonly<{ kind: "UPLOAD_NOT_FOUND" }>
  | Readonly<{ kind: "UPLOAD_NOT_READY" }>
  | Readonly<{ kind: "UPLOAD_INVALID" }>;

// 업로드 완료 저장 포트
export type UploadCompletionStore = Readonly<{
  owned: (input: Readonly<{
    anonymousSessionId: string;
    uploadIntentId: string;
  }>) => Promise<UploadIntentRecord | null>;
  complete: (command: CompletionCommand) => Promise<UploadCompletionResult>;
}>;
