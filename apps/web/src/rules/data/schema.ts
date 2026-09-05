import type {
  Authority,
  ConceptKey,
  LayerConflict,
  Relevance,
  SendOffCategory,
  VarCategory,
  ReviewScenario,
} from "@replay/shared-types";

// 규정 JSON의 인용 구조
// 저장 인용 모델
export type StoredCitation = {
  // 인용 키
  key: string;
  // 인용 판본 이력
  revision: number;
  // 법 조항 이름
  law: string;
  // 조항 세부 구간
  section: string;
  // 인용 관련성
  relevance: Relevance;
  // 원문 페이지
  sourcePage: string | null;
  // 원문 주소
  sourceUrl?: string | null;
  // 저장된 인용 문구
  quoteSnapshot: string;
};

// 저장 규정 파일 모델
export type RuleSetFile = {
  // 규정 판본 식별자
  versionId: string;
  // 규정 권위 기관
  authority: Authority;
  // 규정 에디션
  edition: string;
  // 개념별 인용 목록
  concepts: Record<ConceptKey, StoredCitation[]>;
  // VAR 범주 규칙 목록
  varCategories: {
    id: VarCategory;
    appliesTo: ReviewScenario[];
    requiresCompetitionOption: string | null;
    requiresMistakenIdentity: boolean;
  }[];
  // 검토 시간 예외
  timeWindowExceptions: {
    mistakenIdentity: boolean;
    sendOffCategories: SendOffCategory[];
  };
  // 규정 계층 충돌 목록
  layerConflicts: LayerConflict[];
};
