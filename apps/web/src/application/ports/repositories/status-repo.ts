export type EvidenceView = Readonly<{
  evidenceId: string;
  kind: "FRAME" | "CLIP";
}>;

export type CandidateView = Readonly<{
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

export type AnalysisView = Readonly<{
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

export type RuleView = Readonly<{
  competition: string;
  season: string;
  ifabEdition: string;
  verificationStatus: string;
  sourceUrl: string | null;
}>;

export type MediaView = Readonly<{
  videoAssetId: string;
  videoStatus: string;
  validationErrorCode: string | null;
  analysis: AnalysisView | null;
}>;

export type MediaStatusCommand = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  now: string;
}>;

export type MediaStatusRepo = Readonly<{
  status: (command: MediaStatusCommand) => Promise<MediaView | null>;
}>;

export type AnalysisResultCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  now: string;
}>;

export type AnalysisResultRepo = Readonly<{
  analysis: (command: AnalysisResultCommand) => Promise<AnalysisView | null>;
}>;

export type EvidenceMedia = Readonly<{
  objectKey: string;
  contentType: "image/jpeg" | "video/mp4";
}>;

export type EvidenceMediaCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  evidenceId: string;
  now: string;
}>;

export type EvidenceMediaRepo = Readonly<{
  media: (command: EvidenceMediaCommand) => Promise<EvidenceMedia | null>;
}>;

export type LatestMediaCommand = Readonly<{
  anonymousSessionId: string;
  now: string;
}>;

export type LatestMediaRepo = Readonly<{
  latest: (command: LatestMediaCommand) => Promise<string | null>;
}>;
import type { EvaluationFacts, EvaluationResult, RuleCitation } from "@replay/shared-types";
