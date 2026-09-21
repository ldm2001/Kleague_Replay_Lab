import type { EvaluationResult } from "./evaluation";
import type { PushFacts } from "./facts";

export const AUTOMATIC_REVIEW_VERSION = "automatic-review-v1" as const;
export const AUTOMATIC_NOT_ASSESSED = Object.freeze(["OTHER_FOUL_TYPES", "GOAL_DECISION", "ORIGINAL_DECISION_CORRECTNESS", "VAR_INTERVENTION"] as const);

export type AutomaticRuleContext = Readonly<{
  id: string;
  matchId: string;
  competition: string;
  season: string;
  ifabVersionId: string;
  verificationStatus: "VERIFIED";
}>;

export type AutomaticProducer = Readonly<{
  methodId: string;
  version: string;
  validationReportSha256: string;
}>;

export type AutomaticReviewRow = Readonly<{
  candidateIndex: number;
  question: "PUSHING";
  status: "BLOCKED" | "COMPLETED";
  reasonCodes: readonly string[];
  evidenceIndices: readonly number[];
  producer: AutomaticProducer | null;
  rule: AutomaticRuleContext | null;
  facts: PushFacts | null;
  result: EvaluationResult | null;
}>;

// 서버가 계산하고 job/revision과 원자적으로 저장하는 비공개 평가 묶음.
export type AutomaticReviewBatch = Readonly<{
  version: typeof AUTOMATIC_REVIEW_VERSION;
  analysisId: string;
  jobId: string;
  jobRevision: number;
  sourceSha256: string;
  pipelineVersion: string;
  videoCoverage: "FULL" | "PARTIAL";
  summaryTruncated: boolean;
  evaluatedCount: number;
  blockedCount: number;
  rows: readonly AutomaticReviewRow[];
}>;

// 공개에는 객체 키와 비공개 관측을 포함하지 않는다.
export type AutomaticPublicResult = Pick<EvaluationResult,
  "decision" | "severity" | "restart" | "disciplinary" | "confidence" | "inconclusiveReason" |
  "varAssessment" | "citations" | "decisionMatch" | "factSignature">;

export const publicAutomaticResult = (result: AutomaticPublicResult): AutomaticPublicResult => ({
  decision: result.decision, severity: result.severity, restart: result.restart,
  disciplinary: result.disciplinary, confidence: result.confidence,
  inconclusiveReason: result.inconclusiveReason, varAssessment: result.varAssessment,
  citations: result.citations, decisionMatch: result.decisionMatch, factSignature: result.factSignature,
});

export type AutomaticJudgment = Readonly<{
  kind: "AUTOMATIC_PUSHING";
  status: "COMPLETED";
  evaluatorVersion: typeof AUTOMATIC_REVIEW_VERSION;
  sourceSha256: string;
  candidateIndex: number;
  rule: AutomaticRuleContext;
  producer: AutomaticProducer;
  evidenceIds: readonly string[];
  result: AutomaticPublicResult;
  notAssessed: typeof AUTOMATIC_NOT_ASSESSED;
}>;
