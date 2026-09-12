import { describe, expect, it } from "vitest";
import {
  claim,
  progress,
  result,
  type Clock,
  type JobClaim,
  type JobClaimCommand,
  type JobProgress,
  type JobProgressCommand,
  type JobProgressStore,
  type JobStore,
  type JobResult,
  type JobResultCommand,
  type JobResultPreflight,
  type JobResultPreflightCommand,
  type JobResultStore,
} from "@replay/application";
import {
  PERCEPTION_ANALYSIS_ID,
  PERCEPTION_ARTIFACT_SHA256,
  PERCEPTION_EVIDENCE_SHA256,
  PERCEPTION_JOB_ID,
  PERCEPTION_SOURCE_SHA256,
  perceptionPayload,
} from "../fixtures/perception";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const clock: Clock = { now: () => NOW };

// 작업 선점 저장소 모형
class JobStoreFake implements JobStore {
  readonly commands: JobClaimCommand[] = [];
  result: JobClaim | null = {
    jobId: "11111111-1111-4111-8111-111111111111",
    jobType: "ANALYZE_VIDEO",
    payloadVersion: 1,
  jobRevision: 1,
  attempt: 1,
  stage: "SEGMENTING",
  progressPercent: 0,
    leaseToken: "lease-token",
    leaseUntil: "2026-08-29T00:00:30.000Z",
    analysisId: "22222222-2222-4222-8222-222222222222",
    videoAssetId: "33333333-3333-4333-8333-333333333333",
    objectKey: "uploads/video.mp4",
  };

  async claim(command: JobClaimCommand): Promise<JobClaim | null> {
    this.commands.push(command);
    return this.result;
  }
}

describe("claim", () => {
  it("creates a bounded lease command for a supported job type", async () => {
    // 지원 작업 선점 실행
    const repository = new JobStoreFake();
    const result = await claim({
      clock,
      repository,
      leaseMs: 30_000,
      source: { read: async () => "http://minio.test/source" },
    })({
      workerId: "video-worker-1",
      jobType: "ANALYZE_VIDEO",
    });

    expect(result).toEqual({ ...repository.result, sourceUrl: "http://minio.test/source" });
    expect(repository.commands).toEqual([{
      workerId: "video-worker-1",
      jobType: "ANALYZE_VIDEO",
      now: "2026-08-29T00:00:00.000Z",
      leaseUntil: "2026-08-29T00:00:30.000Z",
    }]);
  });

  it("rejects an unsupported worker or job type before the repository", async () => {
    // 잘못된 작업 선점 실행
    const repository = new JobStoreFake();
    const operation = claim({
      clock,
      repository,
      leaseMs: 30_000,
      source: { read: async () => "http://minio.test/source" },
    });

    await expect(operation({ workerId: "", jobType: "ANALYZE_VIDEO" })).resolves.toEqual({
      kind: "INVALID_INPUT",
      reason: "WORKER_ID",
    });
    await expect(operation({ workerId: "worker-1", jobType: "UNKNOWN" as never })).resolves.toEqual({
      kind: "INVALID_INPUT",
      reason: "JOB_TYPE",
    });
    expect(repository.commands).toHaveLength(0);
  });
});

class ProgressStoreFake implements JobProgressStore {
  readonly commands: JobProgressCommand[] = [];
  result: JobProgress = {
    kind: "UPDATED",
    stage: "DETECTING",
    progressPercent: 40,
    heartbeatAt: "2026-08-29T00:00:00.000Z",
    leaseUntil: "2026-08-29T00:00:30.000Z",
  };

  async progress(command: JobProgressCommand): Promise<JobProgress> {
    this.commands.push(command);
    return this.result;
  }
}

describe("progress", () => {
  it("hashes the lease token and records a bounded progress update", async () => {
    // 진행 상태 저장 실행
    const repository = new ProgressStoreFake();
    const hasher = { sha256: async () => Uint8Array.from([1, 2, 3]) };
    const result = await progress({ clock, hasher, repository, leaseMs: 30_000 })({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      stage: "DETECTING",
      progressPercent: 40,
      message: "candidate scan",
    });

    expect(result).toEqual(repository.result);
    expect(repository.commands).toEqual([{
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseTokenHash: Uint8Array.from([1, 2, 3]),
      stage: "DETECTING",
      progressPercent: 40,
      now: "2026-08-29T00:00:00.000Z",
      leaseUntil: "2026-08-29T00:00:30.000Z",
      message: "candidate scan",
    }]);
  });

  it("rejects an invalid lease or progress before the repository", async () => {
    // 잘못된 진행 상태 실행
    const repository = new ProgressStoreFake();
    const operation = progress({
      clock,
      hasher: { sha256: async () => Uint8Array.from([1]) },
      repository,
      leaseMs: 30_000,
    });

    await expect(operation({
      jobId: "bad",
      workerId: "worker-1",
      jobRevision: 1,
      leaseToken: "token",
      stage: "DETECTING",
      progressPercent: 40,
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "JOB_ID" });
    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      jobRevision: 1,
      leaseToken: "token",
      stage: "DETECTING",
      progressPercent: 101,
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PROGRESS" });
    expect(repository.commands).toHaveLength(0);
  });
});

class ResultStoreFake implements JobResultStore {
  readonly commands: JobResultCommand[] = [];
  response: JobResult = { kind: "ACCEPTED" };

  async result(command: JobResultCommand): Promise<JobResult> {
    this.commands.push(command);
    return this.response;
  }
}

class PerceptionResultStore extends ResultStoreFake {
  readonly preflightCommands: JobResultPreflightCommand[] = [];
  preflightResponse: JobResultPreflight = {
    kind: "AUTHORIZED",
    analysisId: PERCEPTION_ANALYSIS_ID,
    sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
    analysisSourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
    expiresAt: "2026-09-04T00:00:00.000Z",
    ruleEdition: { id: "44444444-4444-4444-8444-444444444444", verificationStatus: "VERIFIED",
      matchId: "33333333-3333-4333-8333-333333333333", ifabEdition: "2026-27" },
  };

  async preflight(command: JobResultPreflightCommand): Promise<JobResultPreflight> {
    this.preflightCommands.push(command);
    return this.preflightResponse;
  }
}

class ResultStorage {
  readonly calls: Array<{ objectKey: string; maxSizeBytes?: number }> = [];
  readonly heads = new Map([
    [`perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`,
      { sizeBytes: 1_024, contentSha256: Uint8Array.from(Buffer.from(PERCEPTION_ARTIFACT_SHA256, "hex")) }],
    [`evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`,
      { sizeBytes: 2_048, contentSha256: Uint8Array.from(Buffer.from(PERCEPTION_EVIDENCE_SHA256, "hex")) }],
  ]);

  async head(objectKey: string, maxSizeBytes?: number) {
    this.calls.push({ objectKey, ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }) });
    return this.heads.get(objectKey) ?? null;
  }
}

describe("result", () => {
  it("hashes the lease token and submits validated video metadata", async () => {
    // 검증 결과 저장 실행
    const repository = new ResultStoreFake();
    const operation = result({
      clock,
      hasher: { sha256: async () => Uint8Array.from([1, 2, 3]) },
      repository,
    });

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: " video-worker-1 ",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload: {
        kind: "VALIDATED",
        durationMs: 90_000,
        width: 1920,
        height: 1080,
      },
    })).resolves.toEqual({ kind: "ACCEPTED" });

    expect(repository.commands).toEqual([{
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseTokenHash: Uint8Array.from([1, 2, 3]),
      now: NOW.toISOString(),
      payload: {
        kind: "VALIDATED",
        durationMs: 90_000,
        width: 1920,
        height: 1080,
      },
    }]);
  });

  it("submits a nonretryable worker failure", async () => {
    const repository = new ResultStoreFake();
    const operation = result({
      clock,
      hasher: { sha256: async () => Uint8Array.from([4, 5, 6]) },
      repository,
    });

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload: {
        kind: "FAILED",
        failureCode: "UNSUPPORTED_CODEC",
        retryable: false,
      },
    })).resolves.toEqual({ kind: "ACCEPTED" });

    expect(repository.commands[0]?.payload).toEqual({
      kind: "FAILED",
      failureCode: "UNSUPPORTED_CODEC",
      retryable: false,
    });
  });

  it("submits baseline analysis shots and candidates", async () => {
    const repository = new ResultStoreFake();
    const operation = result({
      clock,
      hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
      repository,
    });
    const payload = {
      kind: "ANALYZED" as const,
      pipelineVersion: "video-baseline-v1",
      limitations: ["incident_category_classification_pending"],
      shots: [{
        index: 0,
        startMs: 0,
        endMs: 4000,
        playbackSpeed: "UNKNOWN" as const,
        isReplay: false,
        cameraAngle: null,
      }],
      candidates: [{
        index: 1,
        category: "OTHER" as const,
        startMs: 500,
        endMs: 1500,
        anchorMs: 1000,
        confidence: 0.42,
        cameraSufficiency: "MEDIUM" as const,
        reasons: ["motion-spike"],
        shotIndices: [0],
      }],
    };

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload,
    })).resolves.toEqual({ kind: "ACCEPTED" });
    expect(repository.commands[0]?.payload).toEqual(payload);
  });

  it("requires a perception run from the local observers pipeline", async () => {
    const repository = new ResultStoreFake();
    const operation = result({
      clock,
      hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
      repository,
    });

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload: {
        kind: "ANALYZED",
        pipelineVersion: "video-local-observers-v1",
        limitations: [],
        shots: [],
        candidates: [],
        evidence: [],
      },
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });
    expect(repository.commands).toHaveLength(0);
  });

  it.each([
    ["shot index", (payload: any) => { payload.shots.push({ ...payload.shots[0] }); }],
    ["candidate index", (payload: any) => { payload.candidates.push({ ...payload.candidates[0] }); }],
    ["evidence object key", (payload: any) => { payload.evidence.push({ ...payload.evidence[0] }); }],
  ])("rejects duplicate %s values before perception preflight", (_name, duplicate) => {
    const repository = new PerceptionResultStore();
    const payload = structuredClone(perceptionPayload()) as any;
    duplicate(payload);
    return expect(result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage: new ResultStorage() })({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload,
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" }).then(() => {
      expect(repository.preflightCommands).toHaveLength(0);
    });
  });

  it.each([
    { expectedSamples: 0, processedSamples: 0, failedSamples: 0 },
    { expectedSamples: 3, processedSamples: 3, failedSamples: 0 },
  ])("rejects invalid observer sampling arithmetic before preflight %j", async (coverage) => {
    const repository = new PerceptionResultStore();
    const payload = structuredClone(perceptionPayload()) as any;
    Object.assign(payload.perception.coverage, coverage);
    await expect(result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage: new ResultStorage() })({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload,
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });
    expect(repository.preflightCommands).toHaveLength(0);
  });

  it("preflights the lease and source, verifies private objects, refreshes the clock and submits no facts", async () => {
    const repository = new PerceptionResultStore();
    const storage = new ResultStorage();
    const times = [new Date("2026-09-03T00:00:00.000Z"), new Date("2026-09-03T00:00:05.000Z")];
    const operation = result({
      clock: { now: () => times.shift()! },
      hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
      repository,
      storage,
    });

    await expect(operation({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload: perceptionPayload(),
    })).resolves.toEqual({ kind: "ACCEPTED" });

    expect(repository.preflightCommands).toEqual([{
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseTokenHash: Uint8Array.from([7, 8, 9]), now: "2026-09-03T00:00:00.000Z",
    }]);
    expect(storage.calls).toEqual([
      { objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`, maxSizeBytes: 128 * 1_024 * 1_024 },
      { objectKey: `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`, maxSizeBytes: 50 * 1_024 * 1_024 },
    ]);
    expect(repository.commands[0]).toMatchObject({
      now: "2026-09-03T00:00:05.000Z",
      perceptionVerification: {
        analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        admission: { status: "NOT_ADMITTED" },
      },
    });
    expect(repository.commands[0]).not.toHaveProperty("facts");
  });

  it("returns INVALID_RESULT without object access when the authoritative source is unavailable or different", async () => {
    for (const sourceSha256 of [Uint8Array.from([1]), Uint8Array.from(Buffer.from("d".repeat(64), "hex"))]) {
      const repository = new PerceptionResultStore();
      repository.preflightResponse = { ...repository.preflightResponse, sourceSha256 } as JobResultPreflight;
      const storage = new ResultStorage();
      const operation = result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage });
      await expect(operation({ jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
        leaseToken: "lease-token", payload: perceptionPayload() })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
      expect(storage.calls).toHaveLength(0);
      expect(repository.commands).toHaveLength(0);
    }
  });

  it("rejects missing, oversized, size-mismatched or hash-mismatched private objects without throwing", async () => {
    const cases = [
      ["artifact missing", (storage: ResultStorage) => storage.heads.delete(perceptionPayload().perception!.artifact.objectKey)],
      ["artifact wrong size", (storage: ResultStorage) => storage.heads.set(perceptionPayload().perception!.artifact.objectKey,
        { sizeBytes: 2_048, contentSha256: Uint8Array.from(Buffer.from(PERCEPTION_ARTIFACT_SHA256, "hex")) })],
      ["artifact wrong hash", (storage: ResultStorage) => storage.heads.set(perceptionPayload().perception!.artifact.objectKey,
        { sizeBytes: 1_024, contentSha256: Uint8Array.from(Buffer.from("d".repeat(64), "hex")) })],
      ["artifact short checksum", (storage: ResultStorage) => storage.heads.set(perceptionPayload().perception!.artifact.objectKey,
        { sizeBytes: 1_024, contentSha256: Uint8Array.from([1, 2, 3]) })],
      ["reference missing", (storage: ResultStorage) => storage.heads.delete(perceptionPayload().evidence![0]!.objectKey)],
      ["reference wrong hash", (storage: ResultStorage) => storage.heads.set(perceptionPayload().evidence![0]!.objectKey,
        { sizeBytes: 2_048, contentSha256: Uint8Array.from(Buffer.from("d".repeat(64), "hex")) })],
    ] as const;
    for (const [_name, change] of cases) {
      const repository = new PerceptionResultStore();
      const storage = new ResultStorage();
      change(storage);
      const operation = result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage });
      await expect(operation({ jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
        leaseToken: "lease-token", payload: perceptionPayload() })).resolves.toMatchObject({ kind: "INVALID_RESULT" });
      expect(repository.commands).toHaveLength(0);
    }

    const repository = new PerceptionResultStore();
    const storage = new ResultStorage();
    storage.head = async () => { throw new Error("object store unavailable"); };
    await expect(result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage })({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload: perceptionPayload(),
    })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "STORAGE" });
  });

  it("returns lease preflight failures before private object verification", async () => {
    const repository = new PerceptionResultStore();
    repository.preflightResponse = { kind: "STALE_LEASE" };
    const storage = new ResultStorage();
    await expect(result({ clock, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage })({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload: perceptionPayload(),
    })).resolves.toEqual({ kind: "STALE_LEASE" });
    expect(storage.calls).toHaveLength(0);
  });

  it("rejects a run whose private retention expires during object verification", async () => {
    const repository = new PerceptionResultStore();
    repository.preflightResponse = { ...repository.preflightResponse, expiresAt: "2026-09-03T00:00:04.000Z" } as JobResultPreflight;
    const storage = new ResultStorage();
    const times = [new Date("2026-09-03T00:00:00.000Z"), new Date("2026-09-03T00:00:05.000Z")];
    await expect(result({ clock: { now: () => times.shift()! }, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage })({
      jobId: PERCEPTION_JOB_ID, workerId: "video-worker-1", jobRevision: 2,
      leaseToken: "lease-token", payload: perceptionPayload(),
    })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
    expect(repository.commands).toHaveLength(0);
  });

  it("rejects malformed completion data before the repository", async () => {
    const repository = new ResultStoreFake();
    const operation = result({
      clock,
      hasher: { sha256: async () => Uint8Array.from([1]) },
      repository,
    });

    await expect(operation({
      jobId: "bad",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload: {
        kind: "VALIDATED",
        durationMs: 0,
        width: 1920,
        height: 1080,
      },
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "JOB_ID" });

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "video-worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      payload: {
        kind: "VALIDATED",
        durationMs: 0,
        width: 1920,
        height: 1080,
      },
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });

    expect(repository.commands).toHaveLength(0);
  });
});
