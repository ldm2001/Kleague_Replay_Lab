import { createHash as digest } from "node:crypto";
import type { ConceptKey, RuleCitation, RuleSet } from "@replay/shared-types";
import ifab202526 from "../data/ifab/2025-26.json" with { type: "json" };
import ifab202627 from "../data/ifab/2026-27.json" with { type: "json" };
import type { RuleSetFile, StoredCitation } from "./schema";

const FILES: readonly RuleSetFile[] = [ifab202526 as RuleSetFile, ifab202627 as RuleSetFile];

const citation = (file: RuleSetFile, stored: StoredCitation): RuleCitation =>
  Object.freeze({
    ruleId: `${file.versionId}-${stored.key}`,
    ruleRevision: stored.revision,
    // 발췌가 바뀌면 해시가 바뀐다. 그래야 과거 판정이 어느 문구를 근거로 했는지 남는다.
    ruleContentSha256: digest("sha256").update(stored.quoteSnapshot, "utf8").digest("hex"),
    authority: file.authority,
    edition: file.edition,
    law: stored.law,
    section: stored.section,
    relevance: stored.relevance,
    quoteSnapshot: stored.quoteSnapshot,
    sourcePage: stored.sourcePage,
  });

const rule = (file: RuleSetFile): RuleSet => {
  const citations = new Map<ConceptKey, readonly RuleCitation[]>();
  for (const [conceptKey, stored] of Object.entries(file.concepts)) {
    citations.set(
      conceptKey as ConceptKey,
      Object.freeze(stored.map((entry) => citation(file, entry))),
    );
  }

  const varCategories = Object.freeze(
    file.varCategories.map((category) =>
      Object.freeze({
        id: category.id,
        appliesTo: Object.freeze([...category.appliesTo]),
        requiresCompetitionOption: category.requiresCompetitionOption,
        requiresMistakenIdentity: category.requiresMistakenIdentity,
      }),
    ),
  );

  const timeWindowExceptions = Object.freeze({
    mistakenIdentity: file.timeWindowExceptions.mistakenIdentity,
    sendOffCategories: Object.freeze([...file.timeWindowExceptions.sendOffCategories]),
  });

  const layerConflicts = Object.freeze(file.layerConflicts.map((conflict) => Object.freeze(conflict)));

  return Object.freeze({
    cite: (conceptKey: ConceptKey) => [...(citations.get(conceptKey) ?? [])],
    varCategories: () => varCategories,
    timeWindowExceptions: () => timeWindowExceptions,
    layerConflicts: () => layerConflicts,
  });
};

const REGISTRY: ReadonlyMap<string, RuleSet> = new Map(
  FILES.map((file) => [file.versionId, rule(file)]),
);

export const KNOWN_RULE_VERSION_IDS: readonly string[] = Object.freeze([...REGISTRY.keys()]);

/** 알 수 없는 판본이면 null. 던지지 않는 이유는 호출자가 UNKNOWN_RULE_VERSION으로 보고해야 하기 때문. */
export const ruleSet = (versionId: string): RuleSet | null => REGISTRY.get(versionId) ?? null;
