import { createHash as digest } from "node:crypto";
import type { ConceptKey, RuleCitation, RuleSet, VarCategory } from "@replay/shared-types";
import type {
  CompetitionRuleBook,
  CompetitionRuleSelection,
  CompetitionScopeCategory,
} from "../../shared/competition-rules";
import kleague12025 from "./kleague/2025/kleague1.json" with { type: "json" };
import kleague22025 from "./kleague/2025/kleague2.json" with { type: "json" };
import kleague12026 from "./kleague/2026/kleague1.json" with { type: "json" };
import kleague22026 from "./kleague/2026/kleague2.json" with { type: "json" };
import { ruleSet } from "./catalog";
import type { CompetitionRuleBookFile } from "./competition-schema";
import type { StoredCitation } from "./schema";

const FILES: readonly CompetitionRuleBookFile[] = [
  kleague12025 as CompetitionRuleBookFile,
  kleague22025 as CompetitionRuleBookFile,
  kleague12026 as CompetitionRuleBookFile,
  kleague22026 as CompetitionRuleBookFile,
];

const citation = (file: CompetitionRuleBookFile, stored: StoredCitation): RuleCitation =>
  Object.freeze({
    ruleId: `${file.versionId}-${stored.key}`,
    ruleRevision: stored.revision,
    ruleContentSha256: digest("sha256").update(stored.quoteSnapshot, "utf8").digest("hex"),
    authority: "KLEAGUE",
    edition: file.season,
    law: stored.law,
    section: stored.section,
    relevance: stored.relevance,
    quoteSnapshot: stored.quoteSnapshot,
    sourcePage: stored.sourcePage,
    sourceUrl: stored.sourceUrl ?? file.source.url,
  });

const ruleBook = (file: CompetitionRuleBookFile): CompetitionRuleBook => {
  const citations = new Map<ConceptKey, readonly RuleCitation[]>();
  for (const [concept, stored] of Object.entries(file.concepts)) {
    citations.set(concept as ConceptKey, Object.freeze(stored.map((entry) => citation(file, entry))));
  }
  return Object.freeze({
    versionId: file.versionId,
    competition: file.competition,
    season: file.season,
    title: file.title,
    source: Object.freeze({ ...file.source }),
    scopeCategories: Object.freeze(file.scopeCategories.map((category) => Object.freeze({ ...category }))),
    publicAnnouncement: file.publicAnnouncement,
    cite: (concept: ConceptKey) => [...(citations.get(concept) ?? [])],
  });
};

const REGISTRY: ReadonlyMap<string, CompetitionRuleBook> = new Map(
  FILES.map((file) => [`${file.competition}:${file.season}`, ruleBook(file)]),
);

export const competitionRules = (competition: string, season: string): CompetitionRuleBook | null =>
  REGISTRY.get(`${competition}:${season}`) ?? null;

// 대회요강의 네 범주를 실행 어휘로 옮긴다. 세부 적용 대상과 시간 창은 IFAB가 소유한다.
const SCOPE_CATEGORIES: Readonly<Record<CompetitionScopeCategory["topic"], VarCategory>> = Object.freeze({
  GOAL_RELATED: "GOAL_NO_GOAL",
  PENALTY_RELATED: "PENALTY_NO_PENALTY",
  SENDING_OFF_RELATED: "RED_CARD",
  DISCIPLINARY_ERROR: "MISTAKEN_IDENTITY",
});

// 조합 가능 여부만 검사한다. 해당 경기의 판본 채택이나 효력은 별도의 검증된 연결이 필요하다.
export const combineCompetitionRules = ({
  competition,
  season,
  ifabVersionId,
}: CompetitionRuleSelection): RuleSet | null => {
  const base = ruleSet(ifabVersionId);
  const book = competitionRules(competition, season);
  if (!base || !book) return null;
  const scope = new Set(book.scopeCategories.map((category) => SCOPE_CATEGORIES[category.topic]));
  const categories = Object.freeze(base.varCategories().filter((category) => scope.has(category.id)));
  return Object.freeze({
    cite: (concept: ConceptKey) => [...base.cite(concept), ...book.cite(concept)],
    varCategories: () => categories,
    timeWindowExceptions: () => base.timeWindowExceptions(),
    layerConflicts: () => base.layerConflicts(),
  });
};
