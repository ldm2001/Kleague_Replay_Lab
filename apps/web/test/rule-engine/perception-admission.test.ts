import { describe, expect, it } from "vitest";
import { perceptionAdmission, perceptionRecognitionMethods, type PerceptionAdmissionContext } from "@replay/rule-engine";
import type { PerceptionRun } from "@replay/shared-types";

const SOURCE = "a".repeat(64);
const ARTIFACT = "b".repeat(64);
const EVIDENCE = "c".repeat(64);

const run = (): PerceptionRun => ({
  schemaVersion: "perception-run-v1", sourceSha256: SOURCE, processingStatus: "COMPLETE",
  coverage: { startMs: 0, endMs: 2_000, sampleIntervalMs: 500, expectedSamples: 4, processedSamples: 4, failedSamples: 0 },
  models: [
    { component: "detector", modelId: "PekingU/rtdetr_r18vd", revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753", weightsSha256: "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093" },
    { component: "role", modelId: "martinjolif/yolo-football-player-detection", revision: "5e83fafa8d564243001ce8e063612a618a138fbe", weightsSha256: "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd" },
    { component: "pose", modelId: "usyd-community/vitpose-plus-small", revision: "0c30b6534bb621af0162b481176742577264e36e", weightsSha256: "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9" },
  ],
  artifact: { objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${ARTIFACT}.jsonl.gz`, contentType: "application/gzip", contentSha256: ARTIFACT, sizeBytes: 1_024 },
  summary: { roleObservationCount: 1, poseObservationCount: 1, officialCueCount: 1, interactionCount: 1, linkCount: 1, truncated: false, reasons: [] },
  incidents: [{ id: "incident-1", candidateIndex: 1, continuityId: 1, startMs: 600, endMs: 1_400,
    evidenceIndices: [0], officialRole: "UNKNOWN", signal: "UNKNOWN", contact: "UNVERIFIED",
    originalDecision: "UNKNOWN", restart: "UNVERIFIED", reasons: ["method-not-verified"] }],
});

const context = (): PerceptionAdmissionContext => ({
  serverVerified: true,
  pipelineVersion: "video-local-observers-v1",
  sourceSha256: SOURCE,
  artifact: { objectKey: run().artifact.objectKey, contentSha256: ARTIFACT, sizeBytes: 1_024 },
  references: [{ evidenceIndex: 0, candidateIndex: 1, startMs: 1_000, endMs: 1_000,
    declaredContentSha256: EVIDENCE, verifiedContentSha256: EVIDENCE }],
  ruleEdition: { id: "44444444-4444-4444-8444-444444444444", verificationStatus: "VERIFIED",
    matchId: "33333333-3333-4333-8333-333333333333", ifabEdition: "2026-27" },
});

describe("perception admission", () => {
  it("keeps pinned and storage-verified observations private while recognition methods are closed", () => {
    expect(Object.values(perceptionRecognitionMethods)).not.toContain("VERIFIED");
    const result = perceptionAdmission(run(), context());
    expect(result.status).toBe("NOT_ADMITTED");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "ROLE_METHOD_NOT_VERIFIED", "SIGNAL_METHOD_NOT_VERIFIED", "CONTACT_METHOD_NOT_VERIFIED",
      "FOUL_METHOD_NOT_VERIFIED", "ORIGINAL_DECISION_METHOD_NOT_VERIFIED", "RESTART_METHOD_NOT_VERIFIED",
    ]));
    expect(result).not.toHaveProperty("facts");
    expect(JSON.stringify(result)).not.toContain("NO_FOUL");
  });

  it("revokes admission evidence when any incident reference is removed or changed", () => {
    const missing = context() as any;
    missing.references = [];
    expect(perceptionAdmission(run(), missing).reasons).toContain("REFERENCE_MISSING:0");

    const wrongCandidate = context() as any;
    wrongCandidate.references[0]!.candidateIndex = 2;
    expect(perceptionAdmission(run(), wrongCandidate).reasons).toContain("REFERENCE_CANDIDATE_MISMATCH:0");

    const wrongHash = context() as any;
    wrongHash.references[0]!.verifiedContentSha256 = "d".repeat(64);
    expect(perceptionAdmission(run(), wrongHash).reasons).toContain("REFERENCE_HASH_UNVERIFIED:0");
  });

  it("rejects cross-cut references without demanding a clip cover the whole incident", () => {
    const crossCut = context() as any;
    crossCut.references[0]!.startMs = 1_500;
    crossCut.references[0]!.endMs = 1_600;
    expect(perceptionAdmission(run(), crossCut).reasons).toContain("REFERENCE_COVERAGE_INSUFFICIENT:incident-1");

    const oneFrame = context() as any;
    oneFrame.references[0]!.startMs = 800;
    oneFrame.references[0]!.endMs = 800;
    expect(perceptionAdmission(run(), oneFrame).reasons).not.toContain("REFERENCE_COVERAGE_INSUFFICIENT:incident-1");
  });

  it("records partial, truncated, unknown, source, object, pin and edition gates as concrete reasons", () => {
    const value = run() as any;
    value.processingStatus = "PARTIAL";
    value.summary.truncated = true;
    value.models[0]!.revision = "wrong";
    value.incidents[0]!.officialRole = "UNKNOWN";
    value.incidents[0]!.signal = "UNKNOWN";
    const verified = context() as any;
    verified.serverVerified = false;
    verified.sourceSha256 = "d".repeat(64);
    verified.artifact.sizeBytes = 2_048;
    verified.ruleEdition = null;

    expect(perceptionAdmission(value, verified).reasons).toEqual(expect.arrayContaining([
      "SERVER_CONTEXT_UNVERIFIED", "PROCESSING_NOT_COMPLETE", "SUMMARY_TRUNCATED",
      "MODEL_PROVENANCE_UNPINNED:detector", "SOURCE_HASH_UNVERIFIED", "ARTIFACT_UNVERIFIED",
      "RULE_EDITION_UNVERIFIED", "OFFICIAL_ROLE_UNKNOWN:incident-1", "SIGNAL_UNKNOWN:incident-1",
    ]));
  });
});
