// 업로드 저장 포트
// 업로드 권한 모델
export type UploadGrant = Readonly<{
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
}>;

// 업로드 저장소 포트
export type UploadStorage = Readonly<{
  grant: (input: Readonly<{
    anonymousSessionId: string;
    expectedSizeBytes: number;
    contentType: string;
    expiresAt: string;
  }>) => Promise<UploadGrant>;
  cleanup: (objectKey: string) => Promise<void>;
}>;

// 저장 객체 메타데이터
export type UploadedObjectHead = Readonly<{
  sizeBytes: number;
  contentSha256: Uint8Array;
}>;

// 업로드 완료 저장소 포트
export type CompletionStorage = Readonly<{
  head: (objectKey: string) => Promise<UploadedObjectHead | null>;
}>;

// Worker 원본 읽기 포트
export type JobSourceStorage = Readonly<{
  read: (objectKey: string) => Promise<string>;
}>;
