import { AUTOMATIC_NOT_ASSESSED, AUTOMATIC_REVIEW_VERSION, publicAutomaticResult, type AutomaticJudgment, type AutomaticReviewBatch, type AutomaticRuleContext } from "../shared/automatic-review";
import type { AnalysisEvidence } from "../application/ports/repositories/job-store";
import type { EvaluationResult } from "../shared/evaluation";

const completeResult = (result: EvaluationResult | null): result is EvaluationResult => !!result &&
  (result.decision === "FOUL" || result.decision === "NO_FOUL") && result.restart !== null && result.disciplinary !== null &&
  result.inconclusiveReason === null && result.citations.length > 0;

export type AutomaticEvidenceBinding = AnalysisEvidence & Readonly<{ evidenceIndex: number; evidenceId: string }>;
export type AutomaticBindingContext = Readonly<{
  analysisId: string; jobId: string; jobRevision: number; sourceSha256: string;
  pipelineVersion: string; candidateIndices: readonly number[]; evidence: readonly AnalysisEvidence[];
  rule: AutomaticRuleContext | null;
}>;

export function immutableAutomaticEvidence(item: AnalysisEvidence, context: Pick<AutomaticBindingContext, "analysisId" | "jobId" | "jobRevision">): boolean {
  const prefix = `evidence/${context.analysisId}/${context.jobId}/${context.jobRevision}/${item.contentSha256}/`;
  return /^[a-f0-9]{64}$/.test(item.contentSha256) && item.objectKey.startsWith(prefix) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|mp4)$/.test(item.objectKey.slice(prefix.length));
}

export function sameAutomaticRule(a: AutomaticRuleContext | null, b: AutomaticRuleContext | null): boolean {
  return !!a && !!b && a.verificationStatus === "VERIFIED" && b.verificationStatus === "VERIFIED" &&
    a.id === b.id && a.matchId === b.matchId && a.competition === b.competition &&
    a.season === b.season && a.ifabVersionId === b.ifabVersionId;
}

export function validAutomaticBatch(batch: AutomaticReviewBatch, context: AutomaticBindingContext): boolean {
  if (batch.version !== AUTOMATIC_REVIEW_VERSION || batch.analysisId !== context.analysisId || batch.jobId !== context.jobId ||
    batch.jobRevision !== context.jobRevision || batch.sourceSha256 !== context.sourceSha256 || !/^[a-f0-9]{64}$/.test(batch.sourceSha256) ||
    batch.pipelineVersion !== context.pipelineVersion || batch.rows.length !== context.candidateIndices.length ||
    new Set(batch.rows.map((row) => row.candidateIndex)).size !== batch.rows.length ||
    batch.evaluatedCount !== batch.rows.filter((row) => row.status === "COMPLETED").length ||
    batch.blockedCount !== batch.rows.filter((row) => row.status === "BLOCKED").length) return false;
  return batch.rows.every((row) => context.candidateIndices.includes(row.candidateIndex) && row.question === "PUSHING" &&
    row.evidenceIndices.every((index) => Number.isInteger(index) && index >= 0 && context.evidence[index]?.candidateIndex === row.candidateIndex) &&
    (row.status === "BLOCKED" ? row.result === null : row.status === "COMPLETED" &&
      batch.videoCoverage === "FULL" && !batch.summaryTruncated &&
      completeResult(row.result) && row.facts !== null && row.producer !== null &&
      sameAutomaticRule(row.rule, context.rule) && row.evidenceIndices.length > 0 &&
      row.evidenceIndices.some((index) => context.evidence[index]?.kind === "CLIP") &&
      row.evidenceIndices.every((index) => immutableAutomaticEvidence(context.evidence[index]!, context))));
}

export function automaticJudgments(batch: AutomaticReviewBatch, bindings: readonly AutomaticEvidenceBinding[], current: readonly AutomaticEvidenceBinding[], rule: AutomaticRuleContext | null): Map<number, AutomaticJudgment> {
  const result = new Map<number, AutomaticJudgment>();
  if (batch.version !== AUTOMATIC_REVIEW_VERSION || batch.videoCoverage !== "FULL" || batch.summaryTruncated) return result;
  for (const row of batch.rows) {
    if (row.status !== "COMPLETED" || !completeResult(row.result) || !row.producer || !row.rule || !sameAutomaticRule(row.rule, rule) || row.evidenceIndices.length === 0) continue;
    const evidence = row.evidenceIndices.map((index) => bindings.find((item) => item.evidenceIndex === index));
    if (!evidence.some((item) => item?.kind === "CLIP")) continue;
    if (evidence.some((item) => !item || item.candidateIndex !== row.candidateIndex || !immutableAutomaticEvidence(item, batch) || !current.some((live) =>
      live.evidenceId === item.evidenceId && live.candidateIndex === item.candidateIndex && live.contentSha256 === item.contentSha256 &&
      live.objectKey === item.objectKey && live.startMs === item.startMs && live.endMs === item.endMs && live.kind === item.kind))) continue;
    result.set(row.candidateIndex, { kind: "AUTOMATIC_PUSHING", status: "COMPLETED", evaluatorVersion: AUTOMATIC_REVIEW_VERSION,
      sourceSha256: batch.sourceSha256, candidateIndex: row.candidateIndex, rule: row.rule, producer: row.producer,
      evidenceIds: evidence.map((item) => item!.evidenceId), result: publicAutomaticResult(row.result), notAssessed: AUTOMATIC_NOT_ASSESSED });
  }
  return result;
}
