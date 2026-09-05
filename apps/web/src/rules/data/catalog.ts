import { createHash as digest } from "node:crypto";
import type { ConceptKey, RuleCitation, RuleSet } from "@replay/shared-types";
import ifab202526 from "../data/ifab/2025-26.json" with { type: "json" };
import ifab202627 from "../data/ifab/2026-27.json" with { type: "json" };
import type { RuleSetFile, StoredCitation } from "./schema";

const FILES: readonly RuleSetFile[] = [ifab202526 as RuleSetFile, ifab202627 as RuleSetFile];
const DOCUMENTS: Readonly<Record<string, string>> = Object.freeze({
  "2025-26": "https://downloads.theifab.com/downloads/laws-of-the-game-2025-26-single-pages?l=en",
  "2026-27": "https://downloads.theifab.com/downloads/laws-of-the-game-202627-single-pages?l=en",
});

const citation = (file: RuleSetFile, stored: StoredCitation): RuleCitation =>
  // 저장 규정 인용을 실행 모델로 변환
  Object.freeze({
    ruleId: `${file.versionId}-${stored.key}`,
    ruleRevision: stored.revision,
    // 인용 변경 감지 해시
    ruleContentSha256: digest("sha256").update(stored.quoteSnapshot, "utf8").digest("hex"),
    authority: file.authority,
    edition: file.edition,
    law: stored.law,
    section: stored.section,
    relevance: stored.relevance,
    quoteSnapshot: stored.quoteSnapshot,
    sourcePage: stored.sourcePage,
    sourceUrl: stored.sourceUrl ?? (file.authority === "IFAB" ? DOCUMENTS[file.edition] ?? null : null),
  });

const rule = (file: RuleSetFile): RuleSet => {
  // 개념별 인용 맵 초기화
  const citations = new Map<ConceptKey, readonly RuleCitation[]>();
  // 규정 파일의 인용 변환
  for (const [conceptKey, stored] of Object.entries(file.concepts)) {
    citations.set(
      conceptKey as ConceptKey,
      Object.freeze(stored.map((entry) => citation(file, entry))),
    );
  }

  // VAR 검토 범주 복사
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

  // 검토 시간 예외 복사
  const timeWindowExceptions = Object.freeze({
    mistakenIdentity: file.timeWindowExceptions.mistakenIdentity,
    sendOffCategories: Object.freeze([...file.timeWindowExceptions.sendOffCategories]),
  });

  // 규정 계층 충돌 복사
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

// 알 수 없는 판본은 null 결과
export const ruleSet = (versionId: string): RuleSet | null => REGISTRY.get(versionId) ?? null;
