// 애플리케이션 공개 API
export type { Hasher } from "./ports/hashing/hasher";
export type {
  AnalysisCommand,
  AnalysisStore,
  AnalysisResult,
} from "./ports/repositories/analysis-store";
export { analysis } from "./use-cases/analysis";
export type {
  AnalysisDependencies,
  AnalysisInput,
  AnalysisError,
  AnalysisPolicy,
  AnalysisOutcome,
} from "./use-cases/analysis";
export type { Clock } from "./ports/clock/clock";
export type {
  CompletionCommand,
  UploadCompletionStore,
  UploadCompletionResult,
  UploadCommand,
  UploadIntentStore,
  UploadIntentResult,
  UploadIntentRecord,
} from "./ports/repositories/upload-store";
export type {
  SessionGrant,
  SessionIssue,
  SessionLookup,
  SessionRecord,
  SessionStore,
} from "./ports/repositories/session-store";
export type {
  AnalysisCandidate,
  AnalysisEvidence,
  AnalysisPayload,
  AnalysisShot,
  JobClaim,
  JobClaimCommand,
  JobProgress,
  JobProgressCommand,
  JobProgressStore,
  JobStore,
  JobFailurePayload,
  JobResult,
  JobResultCommand,
  JobResultPayload,
  JobResultStore,
  JobStage,
  JobType,
  ValidationPayload,
} from "./ports/repositories/job-store";
export type { CompletionStorage, UploadStorage, JobSourceStorage, UploadGrant, UploadedObjectHead } from "./ports/storage/upload-storage";
export { completion } from "./use-cases/upload/completion";
export type { CompletionDependencies, CompletionInput, CompletionResult } from "./use-cases/upload/completion";
export { upload } from "./use-cases/upload/upload";
export type { UploadDependencies, UploadInput, UploadResult } from "./use-cases/upload/upload";
export type { UploadPolicy } from "./use-cases/upload/policy";
export { record, session } from "./use-cases/session/session";
export type {
  RecordDependencies,
  SessionDependencies,
  SessionPolicy,
} from "./use-cases/session/session";
export { claim } from "./use-cases/job/claim";
export type {
  ClaimDependencies,
  ClaimInput,
  ClaimInvalidReason,
  ClaimResult,
} from "./use-cases/job/claim";
export { progress } from "./use-cases/job/progress";
export type {
  ProgressDependencies,
  ProgressInput,
  ProgressInvalidReason,
  ProgressResult,
} from "./use-cases/job/progress";
export { result } from "./use-cases/job/result";
export type {
  ResultDependencies,
  ResultInput,
  ResultInvalidReason,
  ResultResult,
} from "./use-cases/job/result";
export type {
  AnalysisResultCommand,
  AnalysisResultStore,
  AnalysisView,
  CandidateView,
  EvidenceView,
  EvidenceMedia,
  EvidenceMediaCommand,
  EvidenceMediaStore,
  LatestMediaCommand,
  LatestMediaStore,
  MediaStatusCommand,
  MediaStatusStore,
  MediaView,
  RuleView,
  JudgmentView,
} from "./ports/repositories/status-store";
export { report } from "./use-cases/status/report";
export type { ReportDependencies, ReportInput, ReportResult } from "./use-cases/status/report";
export { status } from "./use-cases/status/status";
export type { StatusDependencies, StatusInput, StatusResult } from "./use-cases/status/status";
export { asset } from "./use-cases/status/evidence";
export type { AssetDependencies, AssetInput, AssetResult } from "./use-cases/status/evidence";
export { latest } from "./use-cases/status/latest";
export type { LatestDependencies, LatestInput, LatestResult } from "./use-cases/status/latest";
export { assessment } from "./use-cases/evaluation/assessment";
export type { AssessmentDependencies, AssessmentInput, AssessmentResult } from "./use-cases/evaluation/assessment";
export { facts } from "./use-cases/evaluation/facts";
export type { FactDependencies, FactInput, FactResult } from "./use-cases/evaluation/facts";
export { decision } from "./use-cases/evaluation/decision";
export type { DecisionDependencies, DecisionInput, DecisionResult } from "./use-cases/evaluation/decision";
export type {
  DecisionSaveCommand,
  DecisionSaveResult,
  EvaluationContext,
  EvaluationContextCommand,
  EvaluationContextResult,
  EvaluationStore,
  FactPatchCommand,
  FactPatchResult,
} from "./ports/repositories/evaluation-store";
export type { EvidenceAccess, EvidenceAccessCommand, EvidenceStore } from "./ports/repositories/evidence-store";
export type { EvidenceBody, EvidenceBodyStorage, EvidenceGrant, EvidenceGrantInput, EvidenceStorage } from "./ports/storage/evidence-storage";
export { evidence } from "./use-cases/job/evidence";
export type { EvidenceDependencies, EvidenceInput, EvidenceItem, EvidenceResult } from "./use-cases/job/evidence";
