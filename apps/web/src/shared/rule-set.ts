import type { LayerConflict, RuleCitation } from "./citation";
import type { SendOffCategory, VarCategory, ReviewScenario } from "./vocabulary";

// 엔진과 규정 데이터 사이의 질문 목록
// 규정 개념 키
export const CONCEPT_KEYS = Object.freeze([
  "LAW_12_DIRECT_FREE_KICK",
  "LAW_12_DISCIPLINE",
  "VAR_REVIEWABLE_CATEGORIES",
  "VAR_TIME_WINDOW",
  "VAR_THRESHOLD",
  "VAR_REVIEW_PROCESS",
] as const);
export type ConceptKey = (typeof CONCEPT_KEYS)[number];

// VAR 범주 규칙
export type VarCategoryRule = {
  id: VarCategory;
  appliesTo: readonly ReviewScenario[];
  // 대회 채택 옵션 키
  requiresCompetitionOption: string | null;
  // 선수 확인 오류 전용 범주 여부
  requiresMistakenIdentity: boolean;
};

// 시간 창 예외 규칙
export type TimeWindowExceptions = {
  mistakenIdentity: boolean;
  sendOffCategories: readonly SendOffCategory[];
};

// 규정 판본 실행 포트
export type RuleSet = {
  cite(conceptKey: ConceptKey): RuleCitation[];
  varCategories(): readonly VarCategoryRule[];
  timeWindowExceptions(): TimeWindowExceptions;
  layerConflicts(): readonly LayerConflict[];
};
