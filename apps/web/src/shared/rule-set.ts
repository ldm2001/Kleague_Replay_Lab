import type { LayerConflict, RuleCitation } from "./citation";
import type { SendOffCategory, VarCategory, ReviewScenario } from "./vocabulary";

// 엔진과 규정 데이터 사이의 질문 목록
export const CONCEPT_KEYS = Object.freeze([
  "LAW_12_DIRECT_FREE_KICK",
  "LAW_12_DISCIPLINE",
  "VAR_REVIEWABLE_CATEGORIES",
  "VAR_TIME_WINDOW",
  "VAR_THRESHOLD",
  "VAR_REVIEW_PROCESS",
] as const);
export type ConceptKey = (typeof CONCEPT_KEYS)[number];

export type VarCategoryRule = {
  id: VarCategory;
  appliesTo: readonly ReviewScenario[];
  // 대회 채택 옵션 키
  requiresCompetitionOption: string | null;
  // 선수 확인 오류 전용 범주 여부
  requiresMistakenIdentity: boolean;
};

export type TimeWindowExceptions = {
  mistakenIdentity: boolean;
  sendOffCategories: readonly SendOffCategory[];
};

export type RuleSet = {
  cite(conceptKey: ConceptKey): RuleCitation[];
  varCategories(): readonly VarCategoryRule[];
  timeWindowExceptions(): TimeWindowExceptions;
  layerConflicts(): readonly LayerConflict[];
};
