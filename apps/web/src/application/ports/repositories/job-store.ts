// 작업 저장 명령과 결과
export type JobType =
  | "VALIDATE_VIDEO"
  | "ANALYZE_VIDEO"
  | "DELETE_VIDEO_ASSET"
  | "PURGE_ANALYSIS";

// 작업 처리 단계
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

// 작업 선점 입력
export type JobClaimCommand = Readonly<{
  workerId: string;
  jobType: JobType;
  now: string;
  leaseUntil: string;
}>;

// 작업 선점 결과
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

// 작업 선점 저장 포트
export type JobStore = Readonly<{
  claim: (command: JobClaimCommand) => Promise<JobClaim | null>;
}>;

// 작업 진행 입력
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

// 작업 진행 결과
export type JobProgress =
  | Readonly<{
      kind: "UPDATED";
      stage: JobStage;
      progressPercent: number;
      heartbeatAt: string;
      leaseUntil: string;
    }>
  | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" }>;

// 작업 진행 저장 포트
export type JobProgressStore = Readonly<{
  progress: (command: JobProgressCommand) => Promise<JobProgress>;
}>;

// 영상 검증 결과 입력
export type ValidationPayload = Readonly<{
  kind: "VALIDATED";
  durationMs: number;
  width: number;
  height: number;
}>;

// 작업 실패 결과
export type JobFailurePayload = Readonly<{
  kind: "FAILED";
  failureCode: string;
  retryable: boolean;
}>;

// 분석 샷 결과
export type AnalysisShot = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
  playbackSpeed: "NORMAL" | "SLOW" | "UNKNOWN";
  isReplay: boolean;
  cameraAngle: string | null;
}>;

// 분석 후보 결과
export type AnalysisCandidate = Readonly<{
  tracking?: import("@replay/shared-types").TrackingSummary | null;
  sceneEvent?: import("@replay/shared-types").SceneEvent | null;
  broadcastCue?: import("@replay/shared-types").BroadcastCue | null;
  index: number;
  category: "OTHER";
  startMs: number;
  endMs: number;
  anchorMs: number;
  confidence: number;
  cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: readonly string[];
  shotIndices: readonly number[];
  // 판정 전 검증이 필요한 영상 관찰 후보
  observation?: import("@replay/shared-types").SceneObservation | null;
}>;

// 분석 증거 결과
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

// 분석 결과 입력
export type AnalysisPayload = Readonly<{
  kind: "ANALYZED";
  pipelineVersion: string;
  limitations: readonly string[];
  shots: readonly AnalysisShot[];
  candidates: readonly AnalysisCandidate[];
  evidence?: readonly AnalysisEvidence[];
}>;

// Worker 결과 payload
export type JobResultPayload = ValidationPayload | AnalysisPayload | JobFailurePayload;

// 작업 결과 저장 입력
export type JobResultCommand = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseTokenHash: Uint8Array;
  now: string;
  payload: JobResultPayload;
}>;

// 작업 결과 저장 상태
export type JobResult = Readonly<{
  kind: "ACCEPTED" | "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED";
}>;

// 작업 결과 저장 포트
export type JobResultStore = Readonly<{
  result: (command: JobResultCommand) => Promise<JobResult>;
}>;
