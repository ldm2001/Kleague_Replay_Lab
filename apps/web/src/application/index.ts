// 애플리케이션 공개 API
// 해시 포트 공개
export type { Hasher } from "./ports/hashing/hasher";
// 분석 저장 포트 공개
export type {
  AnalysisCommand,
  AnalysisStore,
  AnalysisResult,
} from "./ports/repositories/analysis-store";
// 분석 제출 유스케이스 공개
export { analysis } from "./use-cases/analysis";
export type {
  AnalysisDependencies,
  AnalysisInput,
  AnalysisError,
  AnalysisPolicy,
  AnalysisOutcome,
} from "./use-cases/analysis";
// 시간 포트 공개
export type { Clock } from "./ports/clock/clock";
// 업로드 저장 포트 공개
export type {
  CompletionCommand,
  UploadCompletionStore,
  UploadCompletionResult,
  UploadCommand,
  UploadIntentStore,
  UploadIntentResult,
  UploadIntentRecord,
} from "./ports/repositories/upload-store";
// 세션 저장 포트 공개
export type {
  SessionGrant,
  SessionIssue,
  SessionLookup,
  SessionRecord,
  SessionStore,
} from "./ports/repositories/session-store";
// 작업 저장 포트 공개
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
// 업로드 저장소 포트 공개
export type { CompletionStorage, UploadStorage, JobSourceStorage, UploadGrant, UploadedObjectHead } from "./ports/storage/upload-storage";
// 업로드 완료 유스케이스 공개
export { completion } from "./use-cases/upload/completion";
export type { CompletionDependencies, CompletionInput, CompletionResult } from "./use-cases/upload/completion";
// 업로드 생성 유스케이스 공개
export { upload } from "./use-cases/upload/upload";
export type { UploadDependencies, UploadInput, UploadResult } from "./use-cases/upload/upload";
export type { UploadPolicy } from "./use-cases/upload/policy";
// 세션 유스케이스 공개
export { record, session } from "./use-cases/session/session";
export type {
  RecordDependencies,
  SessionDependencies,
  SessionPolicy,
} from "./use-cases/session/session";
// 작업 선점 유스케이스 공개
export { claim } from "./use-cases/job/claim";
export type {
  ClaimDependencies,
  ClaimInput,
  ClaimInvalidReason,
  ClaimResult,
} from "./use-cases/job/claim";
// 작업 진행 유스케이스 공개
export { progress } from "./use-cases/job/progress";
export type {
  ProgressDependencies,
  ProgressInput,
  ProgressInvalidReason,
  ProgressResult,
} from "./use-cases/job/progress";
// 작업 결과 유스케이스 공개
export { result } from "./use-cases/job/result";
export type {
  ResultDependencies,
  ResultInput,
  ResultInvalidReason,
  ResultResult,
} from "./use-cases/job/result";
// 결과 조회 포트 공개
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
// 결과 조회 유스케이스 공개
export { report } from "./use-cases/status/report";
export type { ReportDependencies, ReportInput, ReportResult } from "./use-cases/status/report";
// 영상 상태 유스케이스 공개
export { status } from "./use-cases/status/status";
export type { StatusDependencies, StatusInput, StatusResult } from "./use-cases/status/status";
// 증거 미디어 유스케이스 공개
export { asset } from "./use-cases/status/evidence";
export type { AssetDependencies, AssetInput, AssetResult } from "./use-cases/status/evidence";
// 최근 영상 유스케이스 공개
export { latest } from "./use-cases/status/latest";
export type { LatestDependencies, LatestInput, LatestResult } from "./use-cases/status/latest";
// 규정 평가 유스케이스 공개
export { assessment } from "./use-cases/evaluation/assessment";
export type { AssessmentDependencies, AssessmentInput, AssessmentResult } from "./use-cases/evaluation/assessment";
// 사실 수정 유스케이스 공개
export { facts } from "./use-cases/evaluation/facts";
export type { FactDependencies, FactInput, FactResult } from "./use-cases/evaluation/facts";
// 판정 저장 유스케이스 공개
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
// 증거 접근 포트 공개
export type { EvidenceAccess, EvidenceAccessCommand, EvidenceStore } from "./ports/repositories/evidence-store";
// 증거 업로드 유스케이스 공개
export type { EvidenceBody, EvidenceBodyStorage, EvidenceGrant, EvidenceGrantInput, EvidenceStorage } from "./ports/storage/evidence-storage";
// 증거 권한 유스케이스 공개
export { evidence } from "./use-cases/job/evidence";
export type { EvidenceDependencies, EvidenceInput, EvidenceItem, EvidenceResult } from "./use-cases/job/evidence";
