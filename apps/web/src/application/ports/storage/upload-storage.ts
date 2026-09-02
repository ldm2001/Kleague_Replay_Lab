export type UploadGrant = Readonly<{
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
}>;

export type CreateUploadStorage = Readonly<{
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

export type CompleteUploadStorage = Readonly<{
  head: (objectKey: string) => Promise<UploadedObjectHead | null>;
}>;

export type JobSourceStorage = Readonly<{
  read: (objectKey: string) => Promise<string>;
}>;
