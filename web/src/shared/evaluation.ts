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

/**
 * 네 게이트를 각각 별도 필드로 둔다.
 * 합치면 정답을 내면서 이유를 틀린다 (README 11절, var-19).
 */
export type VarAssessment = {
  reviewable: boolean; // 게이트 1 결과
  category: VarCategory; // 게이트 1
  withinTimeWindow: boolean; // 게이트 2
  thresholdMet: VarThresholdResult; // 게이트 3
  reviewProcedure: VarReviewProcedure; // 게이트 4 — 문턱과 무관
  intervention: VarIntervention;
  /** 어느 게이트가 막았는가. */
  noInterventionReason: VarNoInterventionReason | null;
  /** 범주 게이트가 왜 막았는가. */
  notReviewableReason: VarNotReviewableReason | null;
  /** 시한 게이트가 왜 막았는가. */
  windowClosedReason: VarWindowClosedReason | null;
  /** NONE이 아니면 재개 여부와 무관하게 withinTimeWindow는 참이다. */
  windowException: VarWindowException;
  explanation: string;
};

export type EvaluationResult = {
  // 1. 규정이 이 상황에 대해 말하는 것
  accounts: AuthorityAccount[];
  conflicts: LayerConflict[];

  // 2. 조항 트리에서 도달한 깊이
  narrowedTo: RuleCitation[];
  blockedFrom: FactRequirement[];

  // 3. VAR 네 게이트 — 밀기 경로에서는 계산하지 않으므로 null
  varAssessment: VarAssessment | null;

  // 4. 참고 — 규정을 적용하면 나오는 판정
  decision: Decision;
  severity: Severity | null;
  restart: RestartType | null;
  disciplinary: DisciplinaryAction | null;
  decisionMatch: DecisionMatch;

  // 5. 한계
  confidence: ConfidenceLevel;
  inconclusiveReason: InconclusiveReason | null;

  // 6. 재현
  factSignature: string;
  factSignatureInput: string;

  citations: RuleCitation[]; // 비어 있을 수 없음
};

/** 입력이 부족하다는 신호. 판정 결과와 형태가 다르다. */
export type EvaluationFailure = {
  ok: false;
  error: EvaluationErrorCode;
  message: string;
};

export type VarOutcome =
  | {
      ok: true;
      assessment: VarAssessment;
      citations: RuleCitation[];
      factSignature: string;
      factSignatureInput: string;
    }
  | EvaluationFailure;

export const isEvaluationFailure = (outcome: VarOutcome): outcome is EvaluationFailure =>
  outcome.ok === false;
