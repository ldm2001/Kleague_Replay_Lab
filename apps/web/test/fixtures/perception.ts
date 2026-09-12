import type { AnalysisPayload } from "@replay/application";

export const PERCEPTION_SOURCE_SHA256 = "a".repeat(64);
export const PERCEPTION_ARTIFACT_SHA256 = "b".repeat(64);
export const PERCEPTION_EVIDENCE_SHA256 = "c".repeat(64);
export const PERCEPTION_ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";
export const PERCEPTION_JOB_ID = "11111111-1111-4111-8111-111111111111";

export const perceptionPayload = (): AnalysisPayload => ({
  kind: "ANALYZED",
  pipelineVersion: "video-local-observers-v1",
  limitations: [],
  shots: [{ index: 0, startMs: 0, endMs: 2_000, playbackSpeed: "NORMAL", isReplay: false, cameraAngle: null }],
  candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1_500, anchorMs: 1_000,
    confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: ["motion-spike"], shotIndices: [0] }],
  evidence: [{ candidateIndex: 1, kind: "FRAME",
    objectKey: `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`,
    contentSha256: PERCEPTION_EVIDENCE_SHA256, startMs: 1_000, endMs: 1_000, width: 1_920, height: 1_080 }],
  perception: {
    schemaVersion: "perception-run-v1",
    sourceSha256: PERCEPTION_SOURCE_SHA256,
    processingStatus: "COMPLETE",
    coverage: { startMs: 0, endMs: 2_000, sampleIntervalMs: 500, expectedSamples: 4, processedSamples: 4, failedSamples: 0 },
    models: [
      { component: "detector", modelId: "PekingU/rtdetr_r18vd", revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753", weightsSha256: "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093" },
      { component: "role", modelId: "martinjolif/yolo-football-player-detection", revision: "5e83fafa8d564243001ce8e063612a618a138fbe", weightsSha256: "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd" },
      { component: "pose", modelId: "usyd-community/vitpose-plus-small", revision: "0c30b6534bb621af0162b481176742577264e36e", weightsSha256: "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9" },
    ],
    artifact: {
      objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`,
      contentType: "application/gzip", contentSha256: PERCEPTION_ARTIFACT_SHA256, sizeBytes: 1_024,
    },
    summary: { roleObservationCount: 1, poseObservationCount: 1, officialCueCount: 0,
      interactionCount: 1, linkCount: 1, truncated: false, reasons: [] },
    incidents: [{ id: "incident-1", candidateIndex: 1, continuityId: 1, startMs: 600, endMs: 1_400,
      evidenceIndices: [0], officialRole: "UNKNOWN", signal: "UNKNOWN", contact: "UNVERIFIED",
      originalDecision: "UNKNOWN", restart: "UNVERIFIED", reasons: ["method-not-verified"] }],
  },
});
