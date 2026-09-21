import { combineCompetitionRules } from "@replay/rule-data";
import { perceptionModelPins, pushResult } from "@replay/rule-engine";
import {
  AUTOMATIC_REVIEW_VERSION, type AutomaticProducer, type AutomaticReviewBatch,
  type AutomaticReviewRow, type AutomaticRuleContext, type PerceptionIncident, type PerceptionRun, type PushFacts,
} from "@replay/shared-types";
import type { AnalysisCandidate } from "../../ports/repositories/job-store";
import { pushFactsData } from "./facts";

export type AutomaticReference = Readonly<{
  evidenceIndex: number; candidateIndex: number; kind: "FRAME" | "CLIP";
  startMs: number; endMs: number; contentSha256: string; immutable: boolean;
}>;

export type AutomaticReviewInput = Readonly<{
  analysisId: string; jobId: string; jobRevision: number; durationMs: number;
  sourceSha256: string; pipelineVersion: string; perception: PerceptionRun;
  candidates: readonly AnalysisCandidate[]; references: readonly AutomaticReference[];
  rule: AutomaticRuleContext | null;
}>;

export type AutomaticFacts =
  | Readonly<{ kind: "UNSUPPORTED"; reasons: readonly string[] }>
  | Readonly<{ kind: "READY"; producer: AutomaticProducer; facts: PushFacts; evidenceIndices: readonly number[] }>;

export type AutomaticReviewDependencies = Readonly<{
  registry: readonly AutomaticProducer[];
  produce: (input: Readonly<{ perception: PerceptionRun; candidate: AnalysisCandidate; incident: PerceptionIncident }>) => AutomaticFacts;
}>;

// 검출·관절·음향 단서는 아직 규정 사실의 검증된 생산자가 아니다.
// 운영자가 환경변수나 Worker payload로 승인 목록을 열 수 없게 한다.
const operating: AutomaticReviewDependencies = Object.freeze({
  registry: Object.freeze([]),
  produce: () => ({ kind: "UNSUPPORTED" as const, reasons: [
    "FACT_PRODUCER_UNVERIFIED", "CONTACT_UNVERIFIED", "INTENSITY_UNVERIFIED", "MATCH_CONTEXT_FACTS_UNVERIFIED",
  ] }),
});

const hash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const sameProducer = (a: AutomaticProducer, b: AutomaticProducer): boolean =>
  a.methodId === b.methodId && a.version === b.version && a.validationReportSha256 === b.validationReportSha256 &&
  hash(a.validationReportSha256);

export const automaticReview = (
  input: AutomaticReviewInput,
  dependencies: AutomaticReviewDependencies = operating,
): AutomaticReviewBatch => {
  const run = input.perception;
  const full = Number.isSafeInteger(input.durationMs) && input.durationMs > 0 &&
    run.processingStatus === "COMPLETE" && run.coverage.startMs === 0 && run.coverage.endMs >= input.durationMs &&
    run.coverage.expectedSamples === run.coverage.processedSamples && run.coverage.failedSamples === 0;
  const sharedReasons: string[] = [];
  if (!full) sharedReasons.push("FULL_VIDEO_COVERAGE_INCOMPLETE");
  if (run.summary.truncated) sharedReasons.push("SUMMARY_TRUNCATED");
  if (!hash(input.sourceSha256) || run.sourceSha256 !== input.sourceSha256) sharedReasons.push("SOURCE_HASH_UNVERIFIED");
  if ((run.schemaVersion === "perception-run-v1" && input.pipelineVersion !== "video-local-observers-v1") ||
      (run.schemaVersion === "perception-run-v2" && input.pipelineVersion !== "video-local-observers-av-v1")) {
    sharedReasons.push("PIPELINE_VERSION_UNVERIFIED");
  }
  for (const pin of Object.values(perceptionModelPins)) {
    if (!run.models.some((model) => model.component === pin.component && model.modelId === pin.modelId &&
        model.revision === pin.revision && model.weightsSha256 === pin.weightsSha256)) sharedReasons.push("MODEL_PROVENANCE_UNPINNED");
  }
  const rule = input.rule?.verificationStatus === "VERIFIED" && input.rule.matchId ? input.rule : null;
  const rules = rule ? combineCompetitionRules({ competition: rule.competition, season: rule.season, ifabVersionId: rule.ifabVersionId }) : null;
  if (!rules) sharedReasons.push("RULE_EDITION_UNVERIFIED");
  const references = new Map(input.references.map((item) => [item.evidenceIndex, item]));
  const rows = input.candidates.map((candidate): AutomaticReviewRow => {
    const reasons = [...sharedReasons];
    const incidents = run.incidents.filter((incident) => incident.candidateIndex === candidate.index);
    const blocked = (extra: readonly string[]): AutomaticReviewRow => ({
      candidateIndex: candidate.index, question: "PUSHING", status: "BLOCKED",
      reasonCodes: [...new Set([...reasons, ...extra])], evidenceIndices: [], producer: null, rule,
      facts: null, result: null,
    });
    if (incidents.length !== 1) return blocked([incidents.length ? "INCIDENT_LINK_AMBIGUOUS" : "INCIDENT_UNRECOGNIZED"]);
    const incident = incidents[0]!;
    if (incident.startMs < candidate.startMs || incident.endMs > candidate.endMs ||
        incident.startMs < run.coverage.startMs || incident.endMs > run.coverage.endMs) reasons.push("INCIDENT_COVERAGE_INVALID");
    let produced: AutomaticFacts;
    try { produced = dependencies.produce({ perception: run, candidate, incident }); }
    catch { return blocked(["FACT_PRODUCER_FAILED"]); }
    if (produced.kind !== "READY") return blocked(produced.reasons);
    if (!pushFactsData(produced.facts)) return blocked(["FACT_SCHEMA_INVALID"]);
    if (!dependencies.registry.some((method) => sameProducer(method, produced.producer))) reasons.push("FACT_PRODUCER_UNVERIFIED");
    const evidenceIndices = [...new Set(produced.evidenceIndices)];
    if (!evidenceIndices.length || evidenceIndices.some((index) => !incident.evidenceIndices.includes(index))) reasons.push("EVIDENCE_UNVERIFIED");
    const evidence = evidenceIndices.map((index) => references.get(index));
    if (evidence.some((item) => !item || item.candidateIndex !== candidate.index || !item.immutable || !hash(item.contentSha256)) ||
        !evidence.some((item) => item?.kind === "CLIP" && item.startMs <= incident.startMs && item.endMs >= incident.endMs)) {
      reasons.push("EVIDENCE_UNVERIFIED");
    }
    if (reasons.length || !rules) return blocked([]);
    try {
      const result = pushResult(produced.facts, rules);
      if (result.decision === "INCONCLUSIVE" || result.decision === "OUT_OF_SCOPE" || !result.restart ||
          result.disciplinary === null || result.inconclusiveReason || !result.citations.length) {
        return blocked([result.inconclusiveReason ?? "RULE_EVALUATION_INCOMPLETE"]);
      }
      return { candidateIndex: candidate.index, question: "PUSHING", status: "COMPLETED", reasonCodes: [],
        evidenceIndices, producer: produced.producer, rule, facts: produced.facts, result };
    } catch { return blocked(["RULE_EVALUATION_FAILED"]); }
  });
  return { version: AUTOMATIC_REVIEW_VERSION, analysisId: input.analysisId, jobId: input.jobId, jobRevision: input.jobRevision,
    sourceSha256: input.sourceSha256, pipelineVersion: input.pipelineVersion, videoCoverage: full ? "FULL" : "PARTIAL",
    summaryTruncated: run.summary.truncated, evaluatedCount: rows.filter((row) => row.status === "COMPLETED").length,
    blockedCount: rows.filter((row) => row.status === "BLOCKED").length, rows };
};
