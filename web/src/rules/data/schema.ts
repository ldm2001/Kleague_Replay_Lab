import type {
  Authority,
  ConceptKey,
  LayerConflict,
  Relevance,
  SendOffCategory,
  VarCategory,
  ReviewScenario,
} from "@replay/shared-types";

/** JSON 파일에 저장되는 인용. authority와 edition은 파일 머리에서 온다. */
export type StoredCitation = {
  key: string;
  revision: number;
  law: string;
  section: string;
  relevance: Relevance;
  sourcePage: string | null;
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
