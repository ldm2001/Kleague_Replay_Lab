import type { AuthorityAccount, FactRequirement, LayerConflict, RuleCitation } from "./citation";
import type {
  ConfidenceLevel,
  Decision,
  DecisionMatch,
  DisciplinaryAction,
  EvaluationErrorCode,
  InconclusiveReason,
  RestartType,
  Severity,
  VarCategory,
  VarIntervention,
  VarNoInterventionReason,
  VarNotReviewableReason,
  VarReviewProcedure,
  VarThresholdResult,
  VarWindowClosedReason,
  VarWindowException,
} from "./vocabulary";

// VAR 네 게이트의 독립 결과
export type VarAssessment = {
  // 게이트 1 결과
  reviewable: boolean;
  // 게이트 1 범주
  category: VarCategory;
  // 게이트 2 결과
  withinTimeWindow: boolean;
  // 게이트 3 결과
  thresholdMet: VarThresholdResult;
  // 게이트 4 결과
  reviewProcedure: VarReviewProcedure;
  intervention: VarIntervention;
  // 게이트 차단 사유
  noInterventionReason: VarNoInterventionReason | null;
  // 범주 차단 사유
  notReviewableReason: VarNotReviewableReason | null;
  // 시한 차단 사유
  windowClosedReason: VarWindowClosedReason | null;
  // 예외가 있으면 재개 후에도 검토 창 유지
  windowException: VarWindowException;
  explanation: string;
};

export type EvaluationResult = {
  // 규정이 말하는 내용
  accounts: AuthorityAccount[];
  conflicts: LayerConflict[];

  // 조항 트리 도달 범위
  narrowedTo: RuleCitation[];
  blockedFrom: FactRequirement[];

  // VAR 네 게이트 결과
  varAssessment: VarAssessment | null;

  // 규정 적용 참고 판정
  decision: Decision;
  severity: Severity | null;
  restart: RestartType | null;
  disciplinary: DisciplinaryAction | null;
  decisionMatch: DecisionMatch;

  // 영상과 관측 한계
  confidence: ConfidenceLevel;
  inconclusiveReason: InconclusiveReason | null;

  // 결과 재현 정보
  factSignature: string;
  factSignatureInput: string;

  // 최소 한 개의 인용
  citations: RuleCitation[];
};

// 입력 부족 오류 결과
// 규정 평가 실패 모델
export type EvaluationFailure = {
  ok: false;
  error: EvaluationErrorCode;
  message: string;
};

// VAR 평가 결과
export type VarOutcome =
  | {
      ok: true;
      assessment: VarAssessment;
      citations: RuleCitation[];
      factSignature: string;
      factSignatureInput: string;
    }
  | EvaluationFailure;

// 실패 결과 판별
export const failure = (outcome: VarOutcome): outcome is EvaluationFailure =>
  outcome.ok === false;
