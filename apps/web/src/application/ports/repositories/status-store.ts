// 결과 조회 명령
// 증거 화면 모델
export type EvidenceView = Readonly<{
  evidenceId: string;
  kind: "FRAME" | "CLIP";
}>;

// 후보 화면 모델
export type CandidateView = Readonly<{
  filter?: import("@replay/shared-types").PipelineFilterResult;
  // 최신 사실은 판정이 없어도 보정과 재시도에 사용
  factRevisionId?: string | null;
  facts?: EvaluationFacts | null;
  // 실제 샷의 식별자와 시간 범위
  shots?: readonly Readonly<{ id: string; index: number; startMs: number; endMs: number }>[];
  // 자동 추출한 관찰 후보
  observation?: import("@replay/shared-types").SceneObservation | null;
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  anchorMs: number | null;
  signalScore: number | null;
  cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: readonly string[];
  evidence?: readonly EvidenceView[];
  judgment?: JudgmentView | null;
}>;

// 판정 화면 모델
export type JudgmentView = Readonly<{
  factRevisionId: string;
  facts: EvaluationFacts;
  source: "MODEL" | "USER" | "CURATOR";
  decision: EvaluationResult["decision"];
  severity: EvaluationResult["severity"];
  restart: EvaluationResult["restart"];
  disciplinary: EvaluationResult["disciplinary"];
  decisionMatch: EvaluationResult["decisionMatch"];
  confidence: EvaluationResult["confidence"];
  inconclusiveReason: EvaluationResult["inconclusiveReason"];
  varAssessment: NonNullable<EvaluationResult["varAssessment"]>;
  citations: readonly RuleCitation[];
}>;

// 분석 화면 모델
export type AnalysisView = Readonly<{
  filterSummary?: Readonly<{ checkedCount: number; excludedCount: number; undeterminedCount: number }>;
  analysisId: string;
  mode: "VISUAL_CHANGE_BASELINE" | "ADJUDICATED";
  judgmentStatus: "NOT_EVALUATED" | "PARTIAL" | "EVALUATED";
  status: string;
  stage: string;
  progressPercent: number;
  failureCode: string | null;
  limitations: readonly string[];
  rule?: RuleView | null;
  evaluatedCount?: number;
  candidates: readonly CandidateView[];
}>;

// 규정 판본 화면 모델
export type RuleView = Readonly<{
  competition: string;
  season: string;
  ifabEdition: string;
  verificationStatus: string;
  sourceUrl: string | null;
}>;

// 영상 상태 화면 모델
export type MediaView = Readonly<{
  videoAssetId: string;
  videoStatus: string;
  validationErrorCode: string | null;
  analysis: AnalysisView | null;
}>;

// 영상 상태 조회 입력
export type MediaStatusCommand = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  now: string;
}>;

// 영상 상태 저장 포트
export type MediaStatusStore = Readonly<{
  status: (command: MediaStatusCommand) => Promise<MediaView | null>;
}>;

// 분석 결과 조회 입력
export type AnalysisResultCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  now: string;
}>;

// 분석 결과 저장 포트
export type AnalysisResultStore = Readonly<{
  analysis: (command: AnalysisResultCommand) => Promise<AnalysisView | null>;
}>;

// 증거 미디어 모델
export type EvidenceMedia = Readonly<{
  objectKey: string;
  contentType: "image/jpeg" | "video/mp4";
}>;

// 증거 미디어 조회 입력
export type EvidenceMediaCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  evidenceId: string;
  now: string;
}>;

// 증거 미디어 저장 포트
export type EvidenceMediaStore = Readonly<{
  media: (command: EvidenceMediaCommand) => Promise<EvidenceMedia | null>;
}>;

// 최근 영상 조회 입력
export type LatestMediaCommand = Readonly<{
  anonymousSessionId: string;
  now: string;
}>;

// 최근 영상 저장 포트
export type LatestMediaStore = Readonly<{
  latest: (command: LatestMediaCommand) => Promise<string | null>;
}>;
import type { EvaluationFacts, EvaluationResult, RuleCitation } from "@replay/shared-types";
