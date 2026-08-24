import { describe, expect, it } from "vitest";

import {
  createSubmitAnalysis,
  type Clock,
  type Hasher,
  type SubmitAnalysisCommand,
  type SubmitAnalysisInput,
  type SubmitAnalysisPolicy,
  type SubmitAnalysisRepository,
  type SubmitAnalysisRepositoryResult,
} from "@replay/application";

const ANONYMOUS_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const VIDEO_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const MATCH_ID = "33333333-3333-4333-8333-333333333333";
const ANALYSIS_ID = "44444444-4444-4444-8444-444444444444";
const FIXED_NOW = new Date("2026-08-23T00:00:00.000Z");

const KEY_HASH = Uint8Array.from([1, 2, 3]);
const REQUEST_HASH = Uint8Array.from([4, 5, 6]);

const POLICY = {
  retentionMs: 86_400_000,
  pipelineVersion: "pipeline-v3",
  mediaPolicyVersion: "media-v2",
  jobPayloadVersion: 7,
  maxJobAttempts: 4,
} satisfies SubmitAnalysisPolicy;

const VALID_INPUT = {
  anonymousSessionId: ANONYMOUS_SESSION_ID,
  videoAssetId: VIDEO_ASSET_ID,
  matchId: MATCH_ID,
  idempotencyKey: "raw-idempotency-key",
  sourceUrl: "https://example.com/replay.mp4",
  sourcePlatform: "Example Sports",
} satisfies SubmitAnalysisInput;

class RecordingHasher implements Hasher {
  readonly inputs: string[] = [];

  constructor(private readonly outputs: readonly Uint8Array[] = [KEY_HASH, REQUEST_HASH]) {}

  async sha256(value: string): Promise<Uint8Array> {
    const output = this.outputs[this.inputs.length];
    this.inputs.push(value);

    if (output === undefined) {
      throw new Error("No hash output configured for input");
    }

    return output;
  }
}

class RecordingSubmitAnalysisRepository implements SubmitAnalysisRepository {
  readonly commands: SubmitAnalysisCommand[] = [];

  constructor(private readonly result: SubmitAnalysisRepositoryResult) {}

  async submit(command: SubmitAnalysisCommand): Promise<SubmitAnalysisRepositoryResult> {
    this.commands.push(command);
    return this.result;
  }
}

const createHarness = (
  repositoryResult: SubmitAnalysisRepositoryResult = { kind: "CREATED", analysisId: ANALYSIS_ID },
) => {
  const repository = new RecordingSubmitAnalysisRepository(repositoryResult);
  const hasher = new RecordingHasher();
  const clock: Clock = { now: () => FIXED_NOW };
  const submitAnalysis = createSubmitAnalysis({ repository, hasher, clock, policy: POLICY });

  return { hasher, repository, submitAnalysis };
};

describe("createSubmitAnalysis", () => {
  it("builds the complete repository command with the current time and retention expiry", async () => {
    const { repository, submitAnalysis } = createHarness();

    const result = await submitAnalysis(VALID_INPUT);

    expect(result).toEqual({ kind: "CREATED", analysisId: ANALYSIS_ID });
    expect(repository.commands).toEqual([
      {
        anonymousSessionId: ANONYMOUS_SESSION_ID,
        videoAssetId: VIDEO_ASSET_ID,
        matchId: MATCH_ID,
        sourceUrl: "https://example.com/replay.mp4",
        sourcePlatform: "Example Sports",
        keyHash: KEY_HASH,
        requestHash: REQUEST_HASH,
        createdAt: "2026-08-23T00:00:00.000Z",
        expiresAt: "2026-08-24T00:00:00.000Z",
        pipelineVersion: "pipeline-v3",
        mediaPolicyVersion: "media-v2",
        jobPayloadVersion: 7,
        maxJobAttempts: 4,
      },
    ]);
    expect(repository.commands[0]?.keyHash).toBeInstanceOf(Uint8Array);
    expect(repository.commands[0]?.requestHash).toBeInstanceOf(Uint8Array);
  });

  it("hashes the raw key and exact fixed-order normalized request JSON", async () => {
    const { hasher, submitAnalysis } = createHarness();

    await submitAnalysis({
      ...VALID_INPUT,
      sourceUrl: "  https://example.com/source  ",
      sourcePlatform: "   ",
    });

    expect(hasher.inputs).toEqual([
      "raw-idempotency-key",
      '{"anonymousSessionId":"11111111-1111-4111-8111-111111111111","videoAssetId":"22222222-2222-4222-8222-222222222222","matchId":"33333333-3333-4333-8333-333333333333","sourceUrl":"https://example.com/source","sourcePlatform":null,"pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}',
    ]);
  });

  it("canonicalizes uppercase UUID inputs before hashing and repository submission", async () => {
    const { hasher, repository, submitAnalysis } = createHarness();

    await submitAnalysis({
      ...VALID_INPUT,
      anonymousSessionId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
      videoAssetId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDE0",
      matchId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDE1",
    });

    expect(repository.commands[0]).toMatchObject({
      anonymousSessionId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
      videoAssetId: "abcdefab-cdef-4abc-8def-abcdefabcde0",
      matchId: "abcdefab-cdef-4abc-8def-abcdefabcde1",
    });
    expect(hasher.inputs[1]).toBe(
      '{"anonymousSessionId":"abcdefab-cdef-4abc-8def-abcdefabcdef","videoAssetId":"abcdefab-cdef-4abc-8def-abcdefabcde0","matchId":"abcdefab-cdef-4abc-8def-abcdefabcde1","sourceUrl":"https://example.com/replay.mp4","sourcePlatform":"Example Sports","pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}',
    );
  });

  it("uses one input and policy snapshot when dependencies mutate during hashing", async () => {
    const mutableInput: {
      anonymousSessionId: string;
      videoAssetId: string;
      matchId: string;
      idempotencyKey: string;
      sourceUrl?: string;
      sourcePlatform?: string;
    } = { ...VALID_INPUT };
    const mutablePolicy: {
      retentionMs: number;
      pipelineVersion: string;
      mediaPolicyVersion: string;
      jobPayloadVersion: number;
      maxJobAttempts: number;
    } = { ...POLICY };
    const repository = new RecordingSubmitAnalysisRepository({
      kind: "CREATED",
      analysisId: ANALYSIS_ID,
    });
    const hashInputs: string[] = [];
    let hashCallCount = 0;
    const hasher: Hasher = {
      sha256: async (value) => {
        hashInputs.push(value);
        hashCallCount += 1;

        if (hashCallCount === 1) {
          await Promise.resolve();
          mutableInput.anonymousSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
          mutableInput.videoAssetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
          mutableInput.matchId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
          mutableInput.idempotencyKey = "mutated-key";
          mutableInput.sourceUrl = "https://mutated.example/source";
          mutableInput.sourcePlatform = "Mutated Platform";
          mutablePolicy.retentionMs = 1;
          mutablePolicy.pipelineVersion = "mutated-pipeline";
          mutablePolicy.mediaPolicyVersion = "mutated-media-policy";
          mutablePolicy.jobPayloadVersion = 99;
          mutablePolicy.maxJobAttempts = 99;
        }

        return hashCallCount === 1 ? KEY_HASH : REQUEST_HASH;
      },
    };
    const submitAnalysis = createSubmitAnalysis({
      repository,
      hasher,
      clock: { now: () => FIXED_NOW },
      policy: mutablePolicy,
    });

    await submitAnalysis(mutableInput);

    expect(hashInputs).toEqual([
      "raw-idempotency-key",
      '{"anonymousSessionId":"11111111-1111-4111-8111-111111111111","videoAssetId":"22222222-2222-4222-8222-222222222222","matchId":"33333333-3333-4333-8333-333333333333","sourceUrl":"https://example.com/replay.mp4","sourcePlatform":"Example Sports","pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}',
    ]);
    expect(repository.commands).toEqual([
      {
        anonymousSessionId: ANONYMOUS_SESSION_ID,
        videoAssetId: VIDEO_ASSET_ID,
        matchId: MATCH_ID,
        sourceUrl: "https://example.com/replay.mp4",
        sourcePlatform: "Example Sports",
        keyHash: KEY_HASH,
        requestHash: REQUEST_HASH,
        createdAt: "2026-08-23T00:00:00.000Z",
        expiresAt: "2026-08-24T00:00:00.000Z",
        pipelineVersion: "pipeline-v3",
        mediaPolicyVersion: "media-v2",
        jobPayloadVersion: 7,
        maxJobAttempts: 4,
      },
    ]);
  });

  it("owns independent digest bytes when the hasher reuses its output buffer", async () => {
    const repository = new RecordingSubmitAnalysisRepository({
      kind: "CREATED",
      analysisId: ANALYSIS_ID,
    });
    const sharedDigest = new Uint8Array(3);
    let hashCallCount = 0;
    const hasher: Hasher = {
      sha256: async () => {
        hashCallCount += 1;
        sharedDigest.set(hashCallCount === 1 ? [1, 2, 3] : [4, 5, 6]);
        return sharedDigest;
      },
    };
    const submitAnalysis = createSubmitAnalysis({
      repository,
      hasher,
      clock: { now: () => FIXED_NOW },
      policy: POLICY,
    });

    await submitAnalysis(VALID_INPUT);

    const command = repository.commands[0];
    expect(command?.keyHash).toEqual(Uint8Array.from([1, 2, 3]));
    expect(command?.requestHash).toEqual(Uint8Array.from([4, 5, 6]));
    expect(command?.keyHash).not.toBe(command?.requestHash);

    sharedDigest.fill(9);
    expect(command?.keyHash).toEqual(Uint8Array.from([1, 2, 3]));
    expect(command?.requestHash).toEqual(Uint8Array.from([4, 5, 6]));
  });

  it("trims optional strings and normalizes empty values to null", async () => {
    const { repository, submitAnalysis } = createHarness();

    await submitAnalysis({
      ...VALID_INPUT,
      sourceUrl: "  https://example.com/source  ",
      sourcePlatform: "   ",
    });

    expect(repository.commands[0]).toMatchObject({
      sourceUrl: "https://example.com/source",
      sourcePlatform: null,
    });
  });

  it("normalizes omitted optional strings to null", async () => {
    const { repository, submitAnalysis } = createHarness();
    const inputWithoutSource = {
      anonymousSessionId: ANONYMOUS_SESSION_ID,
      videoAssetId: VIDEO_ASSET_ID,
      matchId: MATCH_ID,
      idempotencyKey: "raw-idempotency-key",
    } satisfies SubmitAnalysisInput;

    await submitAnalysis(inputWithoutSource);

    expect(repository.commands[0]).toMatchObject({ sourceUrl: null, sourcePlatform: null });
  });

  it("rejects an empty idempotency key before calling the repository", async () => {
    const { repository, submitAnalysis } = createHarness();

    const result = await submitAnalysis({ ...VALID_INPUT, idempotencyKey: "" });

    expect(result).toEqual({ kind: "INVALID_INPUT", reason: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(repository.commands).toHaveLength(0);
  });

  it("rejects an idempotency key longer than 200 UTF-8 bytes before calling the repository", async () => {
    const { repository, submitAnalysis } = createHarness();
    const keyWith201Utf8Bytes = "가".repeat(67);
    expect(new TextEncoder().encode(keyWith201Utf8Bytes)).toHaveLength(201);

    const result = await submitAnalysis({ ...VALID_INPUT, idempotencyKey: keyWith201Utf8Bytes });

    expect(result).toEqual({ kind: "INVALID_INPUT", reason: "IDEMPOTENCY_KEY_TOO_LONG" });
    expect(repository.commands).toHaveLength(0);
  });

  it.each(["anonymousSessionId", "videoAssetId", "matchId"] as const)(
    "rejects an invalid %s before calling the repository",
    async (field) => {
      const { repository, submitAnalysis } = createHarness();
      const invalidInput = { ...VALID_INPUT, [field]: "not-a-uuid" } satisfies SubmitAnalysisInput;

      const result = await submitAnalysis(invalidInput);

      expect(result).toEqual({ kind: "INVALID_INPUT", reason: "INVALID_ID" });
      expect(repository.commands).toHaveLength(0);
    },
  );

  const repositoryResults = [
    { kind: "CREATED", analysisId: ANALYSIS_ID },
    { kind: "REPLAYED", analysisId: ANALYSIS_ID },
    { kind: "IDEMPOTENCY_KEY_REUSED" },
    { kind: "VIDEO_ASSET_UNAVAILABLE" },
    { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" },
    { kind: "MATCH_UNAVAILABLE" },
    { kind: "RULE_VERSION_UNAVAILABLE" },
  ] satisfies readonly SubmitAnalysisRepositoryResult[];

  it.each(repositoryResults)("returns the repository's $kind result unchanged", async (repositoryResult) => {
    const { submitAnalysis } = createHarness(repositoryResult);

    const result = await submitAnalysis(VALID_INPUT);

    expect(result).toBe(repositoryResult);
  });
});
