// 작업 저장 명령과 결과
export type JobType =
  | "VALIDATE_VIDEO"
  | "ANALYZE_VIDEO"
  | "DELETE_VIDEO_ASSET"
  | "PURGE_ANALYSIS";

export type JobStage =
  | "QUEUED"
  | "VALIDATING"
  | "SEGMENTING"
  | "DETECTING"
  | "EXTRACTING_FACTS"
  | "BUILDING_EVIDENCE"
  | "APPLYING_RULES"
  | "SUCCEEDED"
  | "FAILED";

export type JobClaimCommand = Readonly<{
  workerId: string;
  jobType: JobType;
  now: string;
  leaseUntil: string;
}>;

export type JobClaim = Readonly<{
  jobId: string;
  jobType: JobType;
  payloadVersion: number;
  jobRevision: number;
  attempt: number;
  stage: JobStage;
  progressPercent: number;
  leaseToken: string;
  leaseUntil: string;
  analysisId: string | null;
  videoAssetId: string | null;
  objectKey: string | null;
  sourceUrl?: string;
}>;

export type JobStore = Readonly<{
  claim: (command: JobClaimCommand) => Promise<JobClaim | null>;
}>;

export type JobProgressCommand = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseTokenHash: Uint8Array;
  stage: JobStage;
  progressPercent: number;
  now: string;
  leaseUntil: string;
  message: string | null;
}>;

export type JobProgress =
  | Readonly<{
      kind: "UPDATED";
      stage: JobStage;
      progressPercent: number;
      heartbeatAt: string;
      leaseUntil: string;
    }>
  | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" }>;

export type JobProgressStore = Readonly<{
  progress: (command: JobProgressCommand) => Promise<JobProgress>;
}>;

export type ValidationPayload = Readonly<{
  kind: "VALIDATED";
  durationMs: number;
  width: number;
  height: number;
}>;

export type JobFailurePayload = Readonly<{
  kind: "FAILED";
  failureCode: string;
  retryable: boolean;
}>;

export type AnalysisShot = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
  playbackSpeed: "NORMAL" | "SLOW" | "UNKNOWN";
  isReplay: boolean;
  cameraAngle: string | null;
}>;

export type AnalysisCandidate = Readonly<{
  index: number;
  category: "OTHER";
  startMs: number;
  endMs: number;
  anchorMs: number;
  confidence: number;
  cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: readonly string[];
  shotIndices: readonly number[];
}>;

export type AnalysisEvidence = Readonly<{
  candidateIndex: number;
  kind: "FRAME" | "CLIP";
  objectKey: string;
  contentSha256: string;
  startMs: number;
  endMs: number;
  width: number | null;
  height: number | null;
}>;

export type AnalysisPayload = Readonly<{
  kind: "ANALYZED";
  pipelineVersion: string;
  limitations: readonly string[];
  shots: readonly AnalysisShot[];
  candidates: readonly AnalysisCandidate[];
  evidence?: readonly AnalysisEvidence[];
}>;

export type JobResultPayload = ValidationPayload | AnalysisPayload | JobFailurePayload;

export type JobResultCommand = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseTokenHash: Uint8Array;
  now: string;
  payload: JobResultPayload;
}>;

export type JobResult = Readonly<{
  kind: "ACCEPTED" | "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED";
}>;

export type JobResultStore = Readonly<{
  result: (command: JobResultCommand) => Promise<JobResult>;
}>;
