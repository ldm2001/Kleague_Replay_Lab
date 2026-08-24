import type { LayerConflict, RuleCitation } from "./citation";
import type { SendOffCategory, VarCategory, ReviewScenario } from "./vocabulary";

/**
 * 엔진이 데이터에게 묻는 것의 전부.
 * 엔진은 이 인터페이스만 알고 어느 판본을 받았는지는 모른다.
 */
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
  /** 대회 채택 옵션 키. null이면 판본만으로 활성화된다. */
  requiresCompetitionOption: string | null;
  /**
   * 선수 확인 오류일 때만 성립하는 범주인가 (IFAB VAR 1.1.d).
   *
   * `appliesTo`로 표현할 수 없는 이유: CARD_SHOWN은 RED_CARD와
   * MISTAKEN_IDENTITY 양쪽의 appliesTo에 들어 있고, 둘을 가르는 것은
   * 사건의 종류가 아니라 카드를 받은 선수가 맞는지다.
   */
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
