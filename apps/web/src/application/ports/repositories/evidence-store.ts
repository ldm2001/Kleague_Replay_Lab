// 증거 접근 명령
export type EvidenceAccessCommand = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseTokenHash: Uint8Array;
  now: string;
}>;

export type EvidenceAccess =
  | Readonly<{ kind: "AUTHORIZED"; analysisId: string }>
  | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED" }>;

export type EvidenceStore = Readonly<{
  access: (command: EvidenceAccessCommand) => Promise<EvidenceAccess>;
}>;
