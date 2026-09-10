import type { RuleCitation } from "./citation";
import type { ConceptKey } from "./rule-set";

export type CompetitionScopeCategory = Readonly<{
  topic: "GOAL_RELATED" | "PENALTY_RELATED" | "SENDING_OFF_RELATED" | "DISCIPLINARY_ERROR";
  sourceLabel: string;
  law: "25";
  section: "1.1" | "1.2" | "1.3" | "1.4";
}>;

// 대회요강의 출처와 명시된 운영 범위다. IFAB 판본 채택을 증명하지 않는다.
export type CompetitionRuleBook = Readonly<{
  versionId: string;
  competition: "K리그1" | "K리그2";
  season: string;
  title: string;
  source: Readonly<{
    url: string;
    documentSha256: string;
    snapshotDate: string | null;
    localPath: string;
  }>;
  scopeCategories: readonly CompetitionScopeCategory[];
  publicAnnouncement: "OFR_ONLY" | "NOT_STATED";
  cite(conceptKey: ConceptKey): RuleCitation[];
}>;

// 호출자가 별도로 확인한 구성요소를 명시한다. 시즌에서 IFAB 판본을 유도하지 않는다.
export type CompetitionRuleSelection = Readonly<{
  competition: string;
  season: string;
  ifabVersionId: string;
}>;
