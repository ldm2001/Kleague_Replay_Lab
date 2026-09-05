export type EvidenceGrantInput = Readonly<{
  analysisId: string;
  jobId: string;
  name: string;
  contentType: "image/jpeg" | "video/mp4";
  sizeBytes: number;
}>;

export type EvidenceGrant = Readonly<{
  objectKey: string;
  uploadUrl: string;
}>;

export type EvidenceStorage = Readonly<{
  evidence: (input: EvidenceGrantInput) => Promise<EvidenceGrant>;
}>;

// 증거 저장 포트
export type EvidenceBody = Readonly<{
  body: AsyncIterable<Uint8Array>;
}>;

export type EvidenceBodyStorage = Readonly<{
  body: (objectKey: string) => Promise<EvidenceBody>;
}>;
