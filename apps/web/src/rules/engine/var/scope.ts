import type { CompetitionRuleBook, ScopeEvidence, ScopeSourceContext, VarScopeEvaluation } from "@replay/shared-types";
import { broadcastCueData, VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";

export type VarScopeInput = Readonly<{
  broadcastCue: unknown;
  startMs: number;
  endMs: number;
  evidence: readonly ScopeEvidence[];
  source: ScopeSourceContext | null;
}>;

export const evaluateVarScope = (input: VarScopeInput, book: CompetitionRuleBook | null): VarScopeEvaluation | null => {
  const { source, broadcastCue: cue } = input;
  if (!source || !book || source.verification !== "REGISTERED_SOURCE_HASH" ||
      !/^[0-9a-f]{64}$/.test(source.sourceSha256) || !source.matchKey || source.sourceUrls.length === 0 ||
      source.competition !== book.competition || source.season !== book.season ||
      !broadcastCueData(cue, input.startMs, input.endMs)) return null;
  // 방송의 득점 관련 표시는 득점 인정이나 취소 사유를 뜻하지 않는다
  const category = book.scopeCategories.find((item) => item.topic === "GOAL_RELATED");
  if (!category) return null;
  const clips = input.evidence.filter((item) => item.kind === "CLIP" && item.evidenceId.length > 0 &&
    Number.isSafeInteger(item.startMs) && Number.isSafeInteger(item.endMs) &&
    item.startMs >= 0 && item.startMs <= cue.startMs && item.endMs >= cue.endMs);
  if (clips.length === 0) return null;
  const citations = book.cite("VAR_REVIEWABLE_CATEGORIES").filter((item) =>
    item.authority === "KLEAGUE" && item.edition === source.season && item.ruleId.startsWith(`${book.versionId}-`) &&
    item.law === category.law && (item.section === category.section || item.section === "1"));
  if (citations.length === 0) return null;
  const editionLabel = book.source.snapshotDate ? `${book.title} (${book.source.snapshotDate} 보관본)` : book.title;
  return {
    kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED", included: true,
    question: "이 득점 관련 장면은 대회요강의 VAR 적용 범주에 해당하는가",
    explanation: `중계의 GOAL 표시가 관찰된 득점 관련 장면으로 제공된 ${editionLabel} 제25조 1항의 득점 상황 범주에 해당합니다`,
    competition: source.competition, season: source.season, ruleVersionId: book.versionId,
    citations, evidenceIds: [...new Set(clips.map((item) => item.evidenceId))], notAssessed: VAR_SCOPE_NOT_ASSESSED,
    provenance: { origin: "VIDEO_CUE_AND_COMPETITION_RULES", evaluatorVersion: "competition-var-scope-v1",
      sourceSha256: source.sourceSha256, matchKey: source.matchKey, sourceUrls: [...source.sourceUrls],
      cueMethod: cue.method, cueStartMs: cue.startMs, cueEndMs: cue.endMs,
      ruleDocumentSha256: book.source.documentSha256 },
  };
};
