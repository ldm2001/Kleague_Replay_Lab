import type { RuleCitation } from "./citation";
import type { CompetitionScopeCategory } from "./competition-rules";

export type BroadcastCue = Readonly<{
  kind: "GOAL_GRAPHIC";
  method: "broadcast-goal-glyphs-v1";
  startMs: number;
  endMs: number;
  evidenceTimestampsMs: readonly number[];
}>;

export type ScopeSourceContext = Readonly<{
  sourceSha256: string;
  matchKey: string;
  competition: "K리그1" | "K리그2";
  season: string;
  verification: "REGISTERED_SOURCE_HASH";
  sourceUrls: readonly string[];
}>;

export type ScopeEvidence = Readonly<{
  evidenceId: string;
  kind: "FRAME" | "CLIP";
  startMs: number;
  endMs: number;
}>;

export const VAR_SCOPE_NOT_ASSESSED = Object.freeze([
  "FOUL_DECISION", "REFEREE_DECISION_CORRECTNESS", "VAR_CHECK_PERFORMED",
  "VAR_INTERVENTION_NECESSITY", "REVIEW_TIME_WINDOW", "IFAB_EDITION_ADOPTION",
] as const);

export type VarScopeEvaluation = Readonly<{
  kind: "COMPETITION_VAR_SCOPE";
  status: "COMPLETED";
  topic: CompetitionScopeCategory["topic"];
  included: boolean;
  question: string;
  explanation: string;
  competition: "K리그1" | "K리그2";
  season: string;
  ruleVersionId: string;
  citations: readonly RuleCitation[];
  evidenceIds: readonly string[];
  notAssessed: typeof VAR_SCOPE_NOT_ASSESSED;
  provenance: Readonly<{
    origin: "VIDEO_CUE_AND_COMPETITION_RULES";
    evaluatorVersion: "competition-var-scope-v1";
    sourceSha256: string;
    matchKey: string;
    sourceUrls: readonly string[];
    cueMethod: BroadcastCue["method"];
    cueStartMs: number;
    cueEndMs: number;
    ruleDocumentSha256: string;
  }>;
}>;

export const broadcastCueData = (value: unknown, startMs: number, endMs: number): value is BroadcastCue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cue = value as Record<string, unknown>;
  const time = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!time(startMs) || !time(endMs) || endMs <= startMs ||
      cue.kind !== "GOAL_GRAPHIC" || cue.method !== "broadcast-goal-glyphs-v1" ||
      !time(cue.startMs) || !time(cue.endMs) || cue.startMs < startMs || cue.endMs > endMs || cue.endMs <= cue.startMs ||
      !Array.isArray(cue.evidenceTimestampsMs) || cue.evidenceTimestampsMs.length < 2 || cue.evidenceTimestampsMs.length > 256) return false;
  const first = cue.startMs, last = cue.endMs;
  const times = cue.evidenceTimestampsMs;
  return times.every((item, index) => time(item) && item >= first && item <= last &&
    (index === 0 || item > times[index - 1])) && times[0] === first && times[times.length - 1] - first >= 300;
};
