// 증거 업로드 권한 입력
export type EvidenceGrantInput = Readonly<{
  analysisId: string;
  jobId: string;
  name: string;
  contentType: "image/jpeg" | "video/mp4";
  sizeBytes: number;
}>;

// 증거 업로드 권한 모델
export type EvidenceGrant = Readonly<{
  objectKey: string;
  uploadUrl: string;
}>;

// 증거 저장소 포트
export type EvidenceStorage = Readonly<{
  evidence: (input: EvidenceGrantInput) => Promise<EvidenceGrant>;
}>;

// 증거 저장 포트
// 증거 본문 모델
export type EvidenceBody = Readonly<{
  body: AsyncIterable<Uint8Array>;
}>;

// 증거 본문 저장소 포트
export type EvidenceBodyStorage = Readonly<{
  body: (objectKey: string) => Promise<EvidenceBody>;
}>;
