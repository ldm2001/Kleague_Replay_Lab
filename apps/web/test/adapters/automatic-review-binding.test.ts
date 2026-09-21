import { describe, expect, it } from "vitest";
import { automaticJudgments, validAutomaticBatch } from "../../src/adapters/automatic-review-binding";
import type { AutomaticReviewBatch } from "../../src/shared/automatic-review";
import { judgment } from "../fixtures/result";

const batch: AutomaticReviewBatch = {
  version: "automatic-review-v1", analysisId: "analysis", jobId: "job", jobRevision: 1,
  sourceSha256: "a".repeat(64), pipelineVersion: "video-local-observers-v1",
  videoCoverage: "PARTIAL", summaryTruncated: false, evaluatedCount: 0, blockedCount: 1,
  rows: [{ candidateIndex: 0, question: "PUSHING", status: "BLOCKED", reasonCodes: ["UNSUPPORTED"], evidenceIndices: [], producer: null, rule: null, facts: null, result: null }],
};
const context = { analysisId: "analysis", jobId: "job", jobRevision: 1, sourceSha256: "a".repeat(64), pipelineVersion: "video-local-observers-v1", candidateIndices: [0], evidence: [], rule: null };
describe("automatic batch binding", () => {
  it("stores blocked work without inventing verified context", () => expect(validAutomaticBatch(batch, context)).toBe(true));
  it("rejects crossed job/revision/source/pipeline/candidate bindings", () => {
    for (const patch of [{ jobId: "other" }, { jobRevision: 2 }, { sourceSha256: "b".repeat(64) }, { pipelineVersion: "other" }, { candidateIndices: [1] }]) {
      expect(validAutomaticBatch(batch, { ...context, ...patch })).toBe(false);
    }
  });
  it("rejects fabricated completed rows and inconsistent counts", () => {
    expect(validAutomaticBatch({ ...batch, evaluatedCount: 1 }, context)).toBe(false);
    expect(validAutomaticBatch({ ...batch, evaluatedCount: 1, blockedCount: 0, rows: [{ ...batch.rows[0]!, status: "COMPLETED" }] }, context)).toBe(false);
  });
  it("fails closed for partial coverage even with completed row data", () => {
    const { completed, rule, binding } = fixture();
    expect(validAutomaticBatch({ ...completed, videoCoverage: "PARTIAL" }, { ...context, rule, evidence: [binding] })).toBe(false);
    expect(automaticJudgments({ ...completed, summaryTruncated: true }, [binding], [binding], rule).size).toBe(0);
  });
  it("exposes only live immutable matching evidence and current rule pins", () => {
    const { completed, rule, binding } = fixture();
    expect(automaticJudgments(completed, [binding], [binding], rule).get(0)?.evidenceIds).toEqual(["evidence"]);
    for (const patch of [{ contentSha256: "b".repeat(64) }, { objectKey: "other" }, { candidateIndex: 1 }, { startMs: 1 }, { evidenceId: "other" }]) {
      expect(automaticJudgments(completed, [binding], [{ ...binding, ...patch }], rule).size).toBe(0);
    }
    expect(automaticJudgments(completed, [binding], [], rule).size).toBe(0);
    expect(automaticJudgments(completed, [binding], [binding], { ...rule, ifabVersionId: "other" }).size).toBe(0);
    expect(JSON.stringify(automaticJudgments(completed, [binding], [binding], rule).get(0))).not.toContain("objectKey");
    expect(JSON.stringify(automaticJudgments(completed, [binding], [binding], rule).get(0))).not.toContain("factSignatureInput");
  });
  it("requires a conclusive complete rules result and a clip", () => {
    const { completed, rule, binding } = fixture();
    for (const patch of [{ decision: "OUT_OF_SCOPE" as const }, { restart: null }, { disciplinary: null }, { citations: [] }]) {
      const modified = { ...completed, rows: [{ ...completed.rows[0]!, result: { ...completed.rows[0]!.result!, ...patch } }] };
      expect(automaticJudgments(modified, [binding], [binding], rule).size).toBe(0);
    }
  });
});

function fixture() {
  const rule = { id: "rule", matchId: "match", competition: "K리그1", season: "2026", ifabVersionId: "ifab-2026-27", verificationStatus: "VERIFIED" as const };
  const binding = { evidenceIndex: 0, evidenceId: "evidence", candidateIndex: 0, kind: "CLIP" as const,
    objectKey: `evidence/analysis/job/1/${"a".repeat(64)}/clip.mp4`, contentSha256: "a".repeat(64), startMs: 0, endMs: 1000, width: null, height: null };
  const completed: AutomaticReviewBatch = { ...batch, videoCoverage: "FULL", evaluatedCount: 1, blockedCount: 0,
    rows: [{ ...batch.rows[0]!, status: "COMPLETED", rule, evidenceIndices: [0], facts: judgment.facts.push,
      producer: { methodId: "test", version: "1", validationReportSha256: "c".repeat(64) },
      result: { ...judgment, citations: [...judgment.citations], accounts: [], conflicts: [], narrowedTo: [], blockedFrom: [], factSignature: "signature", factSignatureInput: "input" } }] };
  return { completed, rule, binding };
}
