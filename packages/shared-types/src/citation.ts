import type { Authority, FactBlocker, FactStatus, Relevance } from "./vocabulary.js";

/**
 * 인용 하나만 떼어내도 출처를 확인할 수 있어야 한다.
 * 상위 객체에 authority가 있어도 여기서 생략하지 않는 이유다 (README 11절).
 */
export type RuleCitation = {
  ruleId: string;
  ruleRevision: number;
  ruleContentSha256: string;
  authority: Authority;
  edition: string;
  law: string; // "12" | "VAR"
  section: string;
  relevance: Relevance;
  quoteSnapshot: string;
  sourcePage: string | null;
};

/** 이 사실값이 정해지지 않으면 조항 트리에서 더 내려갈 수 없다. */
export type FactRequirement = {
  fact: string;
  status: FactStatus;
  /** null은 "관측했으나 값을 특정하지 못함". 관측 자체가 막힌 경우와 구분한다. */
  blockedBy: FactBlocker | null;
  narrowsTo: RuleCitation | null;
};

export type AuthorityAccount = {
  authority: Authority;
  edition: string;
  citations: RuleCitation[];
  requires: FactRequirement[];
};

/** 계층이 서로 다르게 적고 있을 때 — 해소하지 않고 노출한다. */
export type LayerConflict = {
  topic: string;
  readings: { authority: string; text: string }[];
};
