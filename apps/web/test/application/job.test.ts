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
  type JobResultStore,
} from "@replay/application";

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
