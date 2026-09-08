import { describe, expect, it } from "vitest";
import { JobStore } from "@replay/adapters";
import type { EvidenceAccessCommand, JobClaimCommand, JobProgressCommand, JobResultCommand } from "@replay/application";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const command: JobClaimCommand = {
  workerId: "worker-1",
  jobType: "ANALYZE_VIDEO",
  now: "2026-08-29T00:00:00.000Z",
  leaseUntil: "2026-08-29T00:00:30.000Z",
};

const progress: JobProgressCommand = {
  jobId: "11111111-1111-4111-8111-111111111111",
  workerId: "worker-1",
  jobRevision: 2,
  leaseTokenHash: Uint8Array.from([1, 2, 3]),
  stage: "DETECTING",
  progressPercent: 40,
  now: command.now,
  leaseUntil: command.leaseUntil,
  message: "candidate scan",
};

const result: JobResultCommand = {
  jobId: "11111111-1111-4111-8111-111111111111",
  workerId: "worker-1",
  jobRevision: 2,
  leaseTokenHash: Uint8Array.from([1, 2, 3]),
  now: command.now,
  payload: {
    kind: "VALIDATED",
    durationMs: 90_000,
    width: 1920,
    height: 1080,
  },
};

const access: EvidenceAccessCommand = {
  jobId: "11111111-1111-4111-8111-111111111111",
  workerId: "worker-1",
  jobRevision: 2,
  leaseTokenHash: Uint8Array.from([1, 2, 3]),
  now: command.now,
};

const database = (rows: unknown[]) => ({
  transaction: async (operation: (value: { execute: () => Promise<unknown[]> }) => Promise<unknown[]>) =>
    operation({ execute: async () => rows }),
});

// 작업 저장소 테스트
describe("JobStore", () => {
  it("does not infer a match rule edition from the upload clock", async () => {
    const queries: string[] = [];
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        queries.push(new PgDialect().sqlToQuery(statement).sql);
        return [{ kind: "ACCEPTED" }];
      },
    }) } } as never);
    await repository.result(result);
    expect(queries[0]).toContain("NULL::uuid as applied_rule_version_id");
    expect(queries[0]).not.toContain("from competition_rule_versions");
  });

  it("completes an empty pipeline output without waiting for user facts", async () => {
    const queries: string[] = [];
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        queries.push(new PgDialect().sqlToQuery(statement).sql);
        return queries.length === 1 ? [{
          id: result.jobId, status: "PROCESSING", job_type: "ANALYZE_VIDEO",
          job_revision: result.jobRevision, attempt: 1, lease_owner: result.workerId,
          lease_token_hash: Buffer.from(result.leaseTokenHash), lease_until: "2030-01-01T00:00:00Z",
          analysis_id: "22222222-2222-4222-8222-222222222222",
        }] : [];
      },
    }) } } as never);
    await expect(repository.result({ ...result, payload: {
      kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [], candidates: [], evidence: [],
    } })).resolves.toEqual({ kind: "ACCEPTED" });
    const update = queries.find((query) => query.includes("update analyses"));
    expect(update).toContain("status = 'COMPLETED'");
    expect(update).not.toContain("completed_at = null");
  });
  it("maps a claimed row and returns an opaque lease token", async () => {
    const repository = new JobStore({ db: database([{
      id: "11111111-1111-4111-8111-111111111111",
      job_type: "ANALYZE_VIDEO",
      payload_version: 1,
      job_revision: 2,
      attempt: 1,
      stage: "SEGMENTING",
      progress_percent: 0,
      lease_until: command.leaseUntil,
      analysis_id: "22222222-2222-4222-8222-222222222222",
      video_asset_id: "33333333-3333-4333-8333-333333333333",
      object_key: "uploads/video.mp4",
    }]) } as never);

    const result = await repository.claim(command);

    expect(result).toMatchObject({
      jobId: "11111111-1111-4111-8111-111111111111",
      jobType: "ANALYZE_VIDEO",
      jobRevision: 2,
      attempt: 1,
      leaseUntil: command.leaseUntil,
      objectKey: "uploads/video.mp4",
    });
    expect(result?.leaseToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("returns null when the queue has no eligible row", async () => {
    const repository = new JobStore({ db: database([]) } as never);

    await expect(repository.claim(command)).resolves.toBeNull();
  });

  it("maps a progress update returned by the transaction", async () => {
    const repository = new JobStore({
      db: database([{
        stage: "DETECTING",
        progress_percent: 40,
        heartbeat_at: command.now,
        lease_until: command.leaseUntil,
      }]),
    } as never);

    await expect(repository.progress(progress)).resolves.toEqual({
      kind: "UPDATED",
      stage: "DETECTING",
      progressPercent: 40,
      heartbeatAt: command.now,
      leaseUntil: command.leaseUntil,
    });
  });

  it("maps an accepted validation result", async () => {
    const repository = new JobStore({ db: database([{ kind: "ACCEPTED" }]) } as never);

    await expect(repository.result(result)).resolves.toEqual({ kind: "ACCEPTED" });
  });

  it("maps a stale validation lease", async () => {
    const repository = new JobStore({ db: database([{ kind: "STALE_LEASE" }]) } as never);

    await expect(repository.result(result)).resolves.toEqual({ kind: "STALE_LEASE" });
  });

  it("maps authorized analysis evidence access", async () => {
    const repository = new JobStore({ db: { execute: async () => [{ analysis_id: "22222222-2222-4222-8222-222222222222" }] } } as never);

    await expect(repository.access(access)).resolves.toEqual({
      kind: "AUTHORIZED",
      analysisId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
