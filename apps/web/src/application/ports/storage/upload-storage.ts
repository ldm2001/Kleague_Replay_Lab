// 업로드 저장 포트
export type UploadGrant = Readonly<{
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
}>;

export type UploadStorage = Readonly<{
  grant: (input: Readonly<{
    anonymousSessionId: string;
    expectedSizeBytes: number;
    contentType: string;
    expiresAt: string;
  }>) => Promise<UploadGrant>;
  cleanup: (objectKey: string) => Promise<void>;
}>;

export type UploadedObjectHead = Readonly<{
  sizeBytes: number;
  contentSha256: Uint8Array;
}>;

export type CompletionStorage = Readonly<{
  head: (objectKey: string) => Promise<UploadedObjectHead | null>;
}>;

export type JobSourceStorage = Readonly<{
  read: (objectKey: string) => Promise<string>;
}>;
