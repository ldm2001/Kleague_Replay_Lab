// 증거 접근 명령
// 증거 접근 입력
export type EvidenceAccessCommand = Readonly<{
  // 작업 식별자
  jobId: string;
  // Worker 식별자
  workerId: string;
  jobRevision: number;
  leaseTokenHash: Uint8Array;
  now: string;
}>;

// 증거 접근 결과
export type EvidenceAccess =
  | Readonly<{ kind: "AUTHORIZED"; analysisId: string }>
  | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED" }>;

// 증거 저장 포트
export type EvidenceStore = Readonly<{
  access: (command: EvidenceAccessCommand) => Promise<EvidenceAccess>;
}>;
