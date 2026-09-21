import { describe, expect, it } from "vitest";
import {
  perceptionReferencesData,
  perceptionRunData,
  type PerceptionRun,
} from "@replay/shared-types";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const run = (): PerceptionRun => ({
  schemaVersion: "perception-run-v1",
  sourceSha256: SHA_A,
  processingStatus: "COMPLETE",
  coverage: {
    startMs: 0,
    endMs: 2_000,
    sampleIntervalMs: 500,
    expectedSamples: 4,
    processedSamples: 4,
    failedSamples: 0,
  },
  models: [
    { component: "detector", modelId: "detector", revision: "rev-1", weightsSha256: "c".repeat(64) },
    { component: "role", modelId: "role", revision: "rev-2", weightsSha256: "d".repeat(64) },
    { component: "pose", modelId: "pose", revision: "rev-3", weightsSha256: "e".repeat(64) },
  ],
  artifact: {
    objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${SHA_B}.jsonl.gz`,
    contentType: "application/gzip",
    contentSha256: SHA_B,
    sizeBytes: 1_024,
  },
  summary: {
    roleObservationCount: 1,
    poseObservationCount: 1,
    officialCueCount: 1,
    interactionCount: 1,
    linkCount: 1,
    truncated: false,
    reasons: [],
  },
  incidents: [{
    id: "incident-1",
    candidateIndex: 1,
    continuityId: 1,
    startMs: 600,
    endMs: 1_400,
    evidenceIndices: [0],
    officialRole: "UNKNOWN",
    signal: "UNKNOWN",
    contact: "UNVERIFIED",
    originalDecision: "UNKNOWN",
    restart: "UNVERIFIED",
    reasons: ["method-not-yet-verified"],
  }],
});

describe("perception run contract", () => {
  const avRun = (): any => ({ ...run(), schemaVersion: "perception-run-v2",
    audio: {
      version: "audio-observations-v1", sourceSha256: SHA_A, status: "COMPLETE",
      method: "spectral-multitone-v1", speechStatus: "NOT_ANALYZED",
      sourceSampleRateHz: 48_000, sourceChannels: 2,
      timeline: { videoOriginSeconds: 0, audioOffsetMs: 0, scannedStartMs: 0,
        scannedEndMs: 2_000, decodedFrameCount: 20, frameDurationMs: 100,
        gapPolicy: "PRESERVED_WITH_SYNTHETIC_SILENCE" },
      cueCount: 1, cues: [{ id: "cue-1", startMs: 800, endMs: 1_000,
        peakFrequenciesHz: [3_700, 4_100], frameCount: 2 }],
      associations: [{ cueId: "cue-1", candidateIndex: 1, evidenceIndices: [1],
        relation: "TEMPORAL_OVERLAP_ONLY" }],
      truncated: false, reasons: [],
    },
  });

  it("accepts v2 audio and preserves the exact v1 shape", () => {
    expect(perceptionRunData(run())).toBe(true);
    expect(perceptionRunData(avRun())).toBe(true);
    const v1 = structuredClone(run()) as any;
    v1.audio = avRun().audio;
    expect(perceptionRunData(v1)).toBe(false);
    const v2 = avRun();
    delete v2.audio;
    expect(perceptionRunData(v2)).toBe(false);
  });

  it.each([
    ["source mismatch", (v: any) => { v.audio.sourceSha256 = SHA_B; }],
    ["unverified speech", (v: any) => { v.audio.speechStatus = "ANALYZED"; }],
    ["invalid sample rate", (v: any) => { v.audio.sourceSampleRateHz = -1; }],
    ["bad signed offset", (v: any) => { v.audio.timeline.audioOffsetMs = Infinity; }],
    ["bad origin", (v: any) => { v.audio.timeline.videoOriginSeconds = Infinity; }],
    ["cue outside source", (v: any) => { v.audio.cues[0].endMs = 2_100; }],
    ["short cue", (v: any) => { v.audio.cues[0].endMs = 900; }],
    ["bad peak", (v: any) => { v.audio.cues[0].peakFrequenciesHz = [3_700, 4_500.1]; }],
    ["bad retained count", (v: any) => { v.audio.cueCount = 0; }],
    ["duplicate cue id", (v: any) => { v.audio.cues.push(v.audio.cues[0]); v.audio.cueCount = 2; }],
    ["duplicate association", (v: any) => { v.audio.associations.push(v.audio.associations[0]); }],
    ["empty association evidence", (v: any) => { v.audio.associations[0].evidenceIndices = []; }],
    ["unknown cue reference", (v: any) => { v.audio.associations[0].cueId = "other"; }],
    ["bad status", (v: any) => { v.audio.status = "SILENT"; }],
  ])("rejects v2 %s", (_label, mutate) => {
    const value = avRun();
    mutate(value);
    expect(perceptionRunData(value)).toBe(false);
  });

  it("requires audio failure to make an otherwise complete visual run PARTIAL", () => {
    const failed = avRun();
    failed.audio.status = "FAILED";
    expect(perceptionRunData(failed)).toBe(false);
    failed.processingStatus = "PARTIAL";
    expect(perceptionRunData(failed)).toBe(true);
  });

  it("distinguishes absent track, unsupported track and zero-decoded available track", () => {
    const absent = avRun();
    absent.audio = { ...absent.audio, status: "ABSENT", sourceSampleRateHz: null,
      sourceChannels: null, cueCount: 0, cues: [], associations: [],
      timeline: { ...absent.audio.timeline, videoOriginSeconds: null, audioOffsetMs: null,
        scannedStartMs: null, scannedEndMs: null, decodedFrameCount: 0 } };
    expect(perceptionRunData(absent)).toBe(true);
    absent.audio.timeline.decodedFrameCount = 1;
    expect(perceptionRunData(absent)).toBe(false);

    const unsupported = avRun();
    unsupported.processingStatus = "PARTIAL";
    unsupported.audio.status = "UNSUPPORTED";
    unsupported.audio.cueCount = 0;
    unsupported.audio.cues = [];
    unsupported.audio.associations = [];
    expect(perceptionRunData(unsupported)).toBe(true);
    unsupported.processingStatus = "COMPLETE";
    expect(perceptionRunData(unsupported)).toBe(false);

    const delayed = avRun();
    delayed.audio.cueCount = 0;
    delayed.audio.cues = [];
    delayed.audio.associations = [];
    Object.assign(delayed.audio.timeline, { scannedStartMs: 2_000, scannedEndMs: 2_000,
      decodedFrameCount: 0, audioOffsetMs: 3_000 });
    expect(perceptionRunData(delayed)).toBe(true);
  });

  it.each([
    ["too many cues", (v: any) => { v.audio.cues = Array.from({ length: 257 }, (_, i) => ({
      ...v.audio.cues[0], id: `cue-${i}` })); v.audio.cueCount = 257; }],
    ["too many associations", (v: any) => { v.audio.associations = Array.from({ length: 513 }, (_, i) => ({
      ...v.audio.associations[0], candidateIndex: i })); }],
    ["too many evidence links", (v: any) => { v.audio.associations[0].evidenceIndices = Array.from({ length: 17 }, (_, i) => i); }],
    ["duplicate evidence links", (v: any) => { v.audio.associations[0].evidenceIndices = [1, 1]; }],
    ["unmarked truncated count", (v: any) => { v.audio.cueCount = 2; }],
    ["invalid channel count", (v: any) => { v.audio.sourceChannels = 33; }],
    ["oversized id", (v: any) => { v.audio.cues[0].id = "x".repeat(97); }],
    ["oversized reason", (v: any) => { v.audio.reasons = ["x".repeat(129)]; }],
  ])("rejects bounded audio %s", (_label, mutate) => {
    const value = avRun();
    mutate(value);
    expect(perceptionRunData(value)).toBe(false);
  });

  it("requires a same-candidate CLIP to contain the entire associated cue", () => {
    const value = avRun();
    const candidates = [{ index: 1, startMs: 500, endMs: 1_500 }];
    const clip = { candidateIndex: 1, kind: "CLIP" as const, startMs: 700, endMs: 1_100 };
    const frame = { candidateIndex: 1, kind: "FRAME" as const, startMs: 900, endMs: 900 };
    expect(perceptionReferencesData(value, candidates, [frame, clip])).toBe(true);
    expect(perceptionReferencesData(value, candidates, [frame, { ...clip, endMs: 900 }])).toBe(false);
    expect(perceptionReferencesData(value, candidates, [frame, { ...clip, kind: "FRAME" }])).toBe(false);
    expect(perceptionReferencesData(value, candidates, [frame, { ...clip, candidateIndex: 2 }])).toBe(false);
    expect(perceptionReferencesData(value, [{ ...candidates[0]!, startMs: 900 }], [frame, clip])).toBe(false);
    value.audio.associations[0].evidenceIndices = [];
    expect(perceptionReferencesData(value, candidates, [frame, clip])).toBe(false);
  });
  it("accepts the exact bounded v1 shape", () => {
    expect(perceptionRunData(run())).toBe(true);
    const largest = structuredClone(run()) as any;
    largest.artifact.sizeBytes = 128 * 1_024 * 1_024;
    expect(perceptionRunData(largest)).toBe(true);
    largest.artifact.sizeBytes += 1;
    expect(perceptionRunData(largest)).toBe(false);
  });

  it.each([
    ["unknown top-level field", (value: Record<string, unknown>) => { value.extra = true; }],
    ["missing required field", (value: Record<string, unknown>) => { delete value.processingStatus; }],
    ["undefined required field", (value: Record<string, unknown>) => { value.processingStatus = undefined; }],
    ["null required field", (value: Record<string, unknown>) => { value.processingStatus = null; }],
    ["uppercase source hash", (value: Record<string, unknown>) => { value.sourceSha256 = SHA_A.toUpperCase(); }],
    ["artifact hash/key mismatch", (value: Record<string, unknown>) => {
      (value.artifact as Record<string, unknown>).contentSha256 = "f".repeat(64);
    }],
    ["duplicate model component", (value: Record<string, unknown>) => {
      ((value.models as Array<Record<string, unknown>>)[1]!).component = "detector";
    }],
    ["too many incidents", (value: Record<string, unknown>) => {
      value.incidents = Array.from({ length: 129 }, () => (value.incidents as unknown[])[0]);
      (value.summary as Record<string, unknown>).linkCount = 129;
    }],
  ])("rejects %s", (_name, mutate) => {
    const value = structuredClone(run()) as unknown as Record<string, unknown>;
    mutate(value);
    expect(perceptionRunData(value)).toBe(false);
  });

  it("rejects inconsistent processing counts", () => {
    const partial = structuredClone(run()) as any;
    partial.processingStatus = "PARTIAL";
    partial.coverage.processedSamples = 3;
    partial.coverage.failedSamples = 2;
    expect(perceptionRunData(partial)).toBe(false);

    const complete = structuredClone(run()) as any;
    complete.coverage.processedSamples = 3;
    expect(perceptionRunData(complete)).toBe(false);
  });

  it.each([
    { expectedSamples: 0, processedSamples: 0, failedSamples: 0 },
    { expectedSamples: 3, processedSamples: 3, failedSamples: 0 },
    { expectedSamples: 5, processedSamples: 4, failedSamples: 0 },
  ])("rejects zero or miscomputed sample counts %j", (coverage) => {
    const value = structuredClone(run()) as any;
    Object.assign(value.coverage, coverage);
    expect(perceptionRunData(value)).toBe(false);
  });

  it("accepts independent totals when retained incidents are official-only or truncated", () => {
    const officialOnly = structuredClone(run()) as any;
    officialOnly.summary.linkCount = 0;
    expect(perceptionRunData(officialOnly)).toBe(true);

    const truncated = structuredClone(run()) as any;
    truncated.summary.truncated = true;
    truncated.summary.roleObservationCount = 5_000;
    truncated.summary.poseObservationCount = 4_000;
    truncated.summary.officialCueCount = 300;
    truncated.summary.interactionCount = 2_000;
    truncated.summary.linkCount = 1_500;
    expect(perceptionRunData(truncated)).toBe(true);
  });

  it("requires continuity ids to be non-negative safe integers", () => {
    const value = structuredClone(run()) as any;
    value.incidents[0].continuityId = "continuity-1";
    expect(perceptionRunData(value)).toBe(false);
    value.incidents[0].continuityId = Number.MAX_SAFE_INTEGER + 1;
    expect(perceptionRunData(value)).toBe(false);
  });

  it("rejects a run larger than 256 KiB even when every item limit is valid", () => {
    const value = structuredClone(run()) as any;
    value.incidents = Array.from({ length: 128 }, (_, index) => ({
      ...value.incidents[0]!,
      id: `incident-${index}`,
      reasons: Array.from({ length: 32 }, (__, reason) => `${index}-${reason}-`.padEnd(128, "x")),
    }));
    value.summary.linkCount = 128;
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeGreaterThan(256 * 1_024);
    expect(perceptionRunData(value)).toBe(false);
  });

  it("requires incident references to exist and belong to the same bounded candidate", () => {
    const value = run();
    const candidates = [{ index: 1, startMs: 500, endMs: 1_500 }];
    const evidence = [{ candidateIndex: 1, startMs: 1_000, endMs: 1_000 }];
    expect(perceptionReferencesData(value, candidates, evidence)).toBe(true);
    expect(perceptionReferencesData(value, candidates, [])).toBe(false);
    expect(perceptionReferencesData(value, candidates, [{ ...evidence[0]!, candidateIndex: 2 }])).toBe(false);
    expect(perceptionReferencesData(value, [{ index: 1, startMs: 700, endMs: 1_500 }], evidence)).toBe(false);
    expect(perceptionReferencesData(value, candidates, [{ ...evidence[0]!, startMs: 499 }])).toBe(false);
    expect(perceptionReferencesData(value, [...candidates, ...candidates], evidence)).toBe(false);
  });
});
