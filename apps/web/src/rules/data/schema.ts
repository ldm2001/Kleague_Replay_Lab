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
export type StoredCitation = {
  key: string;
  revision: number;
  law: string;
  section: string;
  relevance: Relevance;
  sourcePage: string | null;
  sourceUrl?: string | null;
  quoteSnapshot: string;
};

export type RuleSetFile = {
  versionId: string;
  authority: Authority;
  edition: string;
  concepts: Record<ConceptKey, StoredCitation[]>;
  varCategories: {
    id: VarCategory;
    appliesTo: ReviewScenario[];
    requiresCompetitionOption: string | null;
    requiresMistakenIdentity: boolean;
  }[];
  timeWindowExceptions: {
    mistakenIdentity: boolean;
    sendOffCategories: SendOffCategory[];
  };
  layerConflicts: LayerConflict[];
};
