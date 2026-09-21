import { describe, expect, it } from "vitest";
import { automaticReview } from "../../src/application/use-cases/evaluation/automatic";
import { perceptionPayload, PERCEPTION_ANALYSIS_ID, PERCEPTION_JOB_ID } from "../fixtures/perception";
import { context } from "../fixtures/push-context";
import { observation } from "@replay/shared-types";

const producer = { methodId: "test-only-pushing", version: "1", validationReportSha256: "d".repeat(64) };
const facts = {
  contactDetected: observation(true, "NORMAL", []), severity: observation("CARELESS" as const, "NORMAL", []),
  opponentDisplacement: observation("none" as const, "NORMAL", []), insidePenaltyArea: observation(false, "NORMAL", []),
  cameraSufficiency: "HIGH" as const, context: context(),
};
const input = () => {
  const payload = perceptionPayload();
  return {
    analysisId: PERCEPTION_ANALYSIS_ID, jobId: PERCEPTION_JOB_ID, jobRevision: 2,
    durationMs: 2_000, pipelineVersion: payload.pipelineVersion, sourceSha256: payload.perception!.sourceSha256,
    perception: payload.perception!, candidates: payload.candidates,
    references: [{ evidenceIndex: 0, candidateIndex: 1, kind: "CLIP" as const, startMs: 500, endMs: 1_500,
      contentSha256: "c".repeat(64), immutable: true }],
    rule: { id: "44444444-4444-4444-8444-444444444444", matchId: "55555555-5555-4555-8555-555555555555",
      competition: "K리그2", season: "2026", ifabVersionId: "ifab-2025-26", verificationStatus: "VERIFIED" as const },
  };
};
// 이 생산자는 양성 연결 시험 전용이며 운영 registry에 등록하지 않는다.
const ready = { registry: [producer], produce: () => ({ kind: "READY" as const, producer, facts, evidenceIndices: [0] }) };

describe("automatic server rule review", () => {
  it("runs every candidate but current observers do not manufacture facts", () => {
    const result = automaticReview(input());
    expect(result).toMatchObject({ videoCoverage: "FULL", evaluatedCount: 0, blockedCount: 1 });
    expect(result.rows[0]).toMatchObject({ status: "BLOCKED", facts: null, result: null });
    expect(result.rows[0]?.reasonCodes).toContain("FACT_PRODUCER_UNVERIFIED");
  });

  it("evaluates a server-verified test producer and retains evidence and rule identity", () => {
    const result = automaticReview(input(), ready);
    expect(result.evaluatedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ status: "COMPLETED", question: "PUSHING", evidenceIndices: [0],
      result: { decision: "FOUL", restart: "DIRECT_FREE_KICK", disciplinary: "NONE", varAssessment: null } });
  });

  it.each(["contactDetected", "insidePenaltyArea"] as const)("never completes unknown %s", (field) => {
    const result = automaticReview(input(), { ...ready, produce: () => ({ kind: "READY", producer,
      facts: { ...facts, [field]: observation(null, "NORMAL", []) }, evidenceIndices: [0] }) });
    expect(result.rows[0]?.status).toBe("BLOCKED");
    expect(result.evaluatedCount).toBe(0);
  });

  it("does not trust an unregistered producer even when it returns complete-looking facts", () => {
    expect(automaticReview(input(), { ...ready, registry: [] }).rows[0]?.reasonCodes).toContain("FACT_PRODUCER_UNVERIFIED");
  });

  it("rejects malformed producer facts even from a registered implementation", () => {
    const result = automaticReview(input(), { ...ready, produce: () => ({ kind: "READY", producer,
      facts: { ...facts, severity: observation("INVALID", "NORMAL", []) } as never, evidenceIndices: [0] }) });
    expect(result.evaluatedCount).toBe(0);
    expect(result.rows[0]?.reasonCodes).toContain("FACT_SCHEMA_INVALID");
  });

  it("does not infer a rule edition", () => {
    expect(automaticReview({ ...input(), rule: null }, ready).rows[0]?.reasonCodes).toContain("RULE_EDITION_UNVERIFIED");
  });

  it("requires immutable evidence covering the entire incident", () => {
    for (const references of [[], [{ ...input().references[0]!, immutable: false }], [{ ...input().references[0]!, endMs: 700 }]]) {
      expect(automaticReview({ ...input(), references }, ready).rows[0]?.status).toBe("BLOCKED");
    }
  });

  it("records partial/truncated whole-video coverage without claiming all fouls were checked", () => {
    const value = input();
    value.perception = { ...value.perception, summary: { ...value.perception.summary, truncated: true } };
    expect(automaticReview({ ...value, durationMs: 3_000 }, ready)).toMatchObject({ videoCoverage: "PARTIAL", summaryTruncated: true, evaluatedCount: 0 });
  });

  it("does not turn raw proposals or a claimed Worker judgment into a pushing event", () => {
    const value = input();
    value.perception = { ...value.perception, incidents: [] };
    expect(automaticReview(value, ready).rows[0]?.reasonCodes).toContain("INCIDENT_UNRECOGNIZED");
  });
});
