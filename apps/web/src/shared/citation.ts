import type { Authority, FactBlocker, FactStatus, Relevance } from "./vocabulary";

// 인용 단위 출처 보존
export type RuleCitation = {
  ruleId: string;
  ruleRevision: number;
  ruleContentSha256: string;
  authority: Authority;
  edition: string;
  // 법 조항 구분
  law: string;
  section: string;
  relevance: Relevance;
  quoteSnapshot: string;
  sourcePage: string | null;
  sourceUrl?: string | null;
};

// 조항 탐색을 막는 사실 요구
export type FactRequirement = {
  fact: string;
  status: FactStatus;
  // 관측 불확정과 관측 차단 구분
  blockedBy: FactBlocker | null;
  narrowsTo: RuleCitation | null;
};

export type AuthorityAccount = {
  authority: Authority;
  edition: string;
  citations: RuleCitation[];
  requires: FactRequirement[];
};

// 규정 계층 충돌 기록
export type LayerConflict = {
  topic: string;
  readings: { authority: string; text: string }[];
};
