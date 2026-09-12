import { describe, expect, it } from "vitest";
import { JobStore } from "@replay/adapters";
import type { EvidenceAccessCommand, JobClaimCommand, JobProgressCommand, JobResultCommand, JobResultPreflightCommand } from "@replay/application";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  PERCEPTION_ANALYSIS_ID,
  PERCEPTION_JOB_ID,
  PERCEPTION_SOURCE_SHA256,
  perceptionPayload,
} from "../fixtures/perception";

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
  it("stores the corner observation JSON separately from the review scenario", async () => {
    const sceneEvent = {
      kind: "CORNER_KICK" as const, status: "OBSERVED" as const, startMs: 600, endMs: 1400, restartMs: 1000,
      evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1" as const,
    };
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        queries.push(new PgDialect().sqlToQuery(statement));
        return queries.length === 1 ? [{
          id: result.jobId, status: "PROCESSING", job_type: "ANALYZE_VIDEO",
          job_revision: result.jobRevision, attempt: 1, lease_owner: result.workerId,
          lease_token_hash: Buffer.from(result.leaseTokenHash), lease_until: "2030-01-01T00:00:00Z",
          analysis_id: "22222222-2222-4222-8222-222222222222",
        }] : [];
      },
    }) } } as never);
    await expect(repository.result({ ...result, payload: {
      kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [], evidence: [],
      candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000,
        confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [], sceneEvent }],
    } })).resolves.toEqual({ kind: "ACCEPTED" });
    const insert = queries.find((query) => query.sql.includes("insert into incident_candidates"));
    expect(insert?.sql).toContain("scene_event");
    expect(insert?.params).toContain(JSON.stringify(sceneEvent));
    expect(insert?.params).toContain("OTHER");
  });
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

  it("preflights the active lease with authoritative and copied source hashes without locking", async () => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const preflight: JobResultPreflightCommand = { ...access, jobId: PERCEPTION_JOB_ID };
    const repository = new JobStore({ db: { execute: async (statement: SQL) => {
      queries.push(new PgDialect().sqlToQuery(statement));
      return [{ analysis_id: PERCEPTION_ANALYSIS_ID,
        content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
        source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
        expires_at: "2026-09-04T00:00:00.000Z",
        match_id: "33333333-3333-4333-8333-333333333333", ifab_edition: "2026-27",
        rule_version_id: "44444444-4444-4444-8444-444444444444", verification_status: "VERIFIED" }];
    } } } as never);

    await expect(repository.preflight(preflight)).resolves.toEqual({
      kind: "AUTHORIZED", analysisId: PERCEPTION_ANALYSIS_ID,
      sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
      analysisSourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
      expiresAt: "2026-09-04T00:00:00.000Z",
      ruleEdition: { id: "44444444-4444-4444-8444-444444444444", verificationStatus: "VERIFIED",
        matchId: "33333333-3333-4333-8333-333333333333", ifabEdition: "2026-27" },
    });
    expect(queries[0]?.sql).toContain("join analyses");
    expect(queries[0]?.sql).toContain("join video_assets");
    expect(queries[0]?.sql).not.toContain("for update");
  });

  it("keeps a VERIFIED edition unverified when the analysis has no verified match context", async () => {
    const repository = new JobStore({ db: { execute: async () => [{ analysis_id: PERCEPTION_ANALYSIS_ID,
      content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
      source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"), expires_at: "2026-09-04T00:00:00.000Z",
      match_id: null, ifab_edition: "2026-27", rule_version_id: "44444444-4444-4444-8444-444444444444",
      verification_status: "VERIFIED" }] } } as never);

    await expect(repository.preflight({ ...access, jobId: PERCEPTION_JOB_ID })).resolves.toMatchObject({
      kind: "AUTHORIZED", ruleEdition: null,
    });
  });

  it("atomically persists the private run and NOT_ADMITTED result after source and lease recheck", async () => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const payload = perceptionPayload();
    const command: JobResultCommand = {
      jobId: PERCEPTION_JOB_ID, workerId: "worker-1", jobRevision: 2,
      leaseTokenHash: Uint8Array.from([1, 2, 3]), now: "2026-09-03T00:00:05.000Z", payload,
      perceptionVerification: {
        analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        admission: { status: "NOT_ADMITTED", reasons: ["CONTACT_METHOD_NOT_VERIFIED"] },
      },
    };
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        queries.push(query);
        if (queries.length === 1) return [{
          id: PERCEPTION_JOB_ID, status: "PROCESSING", job_type: "ANALYZE_VIDEO", job_revision: 2,
          attempt: 1, lease_owner: "worker-1", lease_token_hash: Buffer.from([1, 2, 3]),
          lease_until: "2030-01-01T00:00:00.000Z", analysis_id: PERCEPTION_ANALYSIS_ID,
          source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
          content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
          expires_at: "2026-09-04T00:00:00.000Z",
        }];
        if (query.sql.includes("select id") && query.sql.includes("incident_candidates")) {
          return [{ id: "55555555-5555-4555-8555-555555555555" }];
        }
        return [];
      },
    }) } } as never, () => new Date(command.now));

    await expect(repository.result(command)).resolves.toEqual({ kind: "ACCEPTED" });
    expect(queries[0]?.sql).toContain("for update of job, analysis, video");
    const perceptionInsert = queries.find((query) => query.sql.includes("insert into analysis_perception_runs"));
    expect(perceptionInsert?.params).toContain(JSON.stringify(payload.perception!.models));
    expect(perceptionInsert?.params.some((param) => typeof param === "string" && param.includes("CONTACT_METHOD_NOT_VERIFIED"))).toBe(true);
    const perceptionIndex = queries.findIndex((query) => query.sql.includes("insert into analysis_perception_runs"));
    const completeIndex = queries.findIndex((query) => query.sql.includes("update analyses"));
    expect(perceptionIndex).toBeGreaterThan(0);
    expect(completeIndex).toBeGreaterThan(perceptionIndex);
  });

  it("returns INVALID_RESULT before inserts when the transaction source recheck differs", async () => {
    const queries: string[] = [];
    const payload = perceptionPayload();
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        queries.push(query.sql);
        return [{ id: PERCEPTION_JOB_ID, status: "PROCESSING", job_type: "ANALYZE_VIDEO", job_revision: 2,
          attempt: 1, lease_owner: "worker-1", lease_token_hash: Buffer.from([1, 2, 3]),
          lease_until: "2030-01-01T00:00:00.000Z", analysis_id: PERCEPTION_ANALYSIS_ID,
          source_fingerprint: Buffer.from("d".repeat(64), "hex"), content_sha256: Buffer.from("d".repeat(64), "hex"),
          expires_at: "2026-09-04T00:00:00.000Z" }];
      },
    }) } } as never);
    await expect(repository.result({
      jobId: PERCEPTION_JOB_ID, workerId: "worker-1", jobRevision: 2, leaseTokenHash: Uint8Array.from([1, 2, 3]),
      now: "2026-09-03T00:00:05.000Z", payload,
      perceptionVerification: { analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        admission: { status: "NOT_ADMITTED", reasons: [] } },
    })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
    expect(queries).toHaveLength(1);
  });

  it.each([
    { name: "lease expired while waiting", leaseUntil: "2026-09-03T00:00:00.030Z", expiresAt: "2026-09-03T00:00:01.000Z",
      expected: { kind: "STALE_LEASE" } },
    { name: "retention expired while waiting", leaseUntil: "2026-09-03T00:00:01.000Z", expiresAt: "2026-09-03T00:00:00.030Z",
      expected: { kind: "INVALID_RESULT", reason: "SOURCE" } },
    { name: "lease and retention remain active", leaseUntil: "2026-09-03T00:00:01.000Z", expiresAt: "2026-09-03T00:00:02.000Z",
      expected: { kind: "ACCEPTED" } },
  ])("uses fresh post-lock wall time when $name", async ({ leaseUntil, expiresAt, expected }) => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    let lockReturned = false;
    const payload = perceptionPayload();
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        queries.push(query);
        if (queries.length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          lockReturned = true;
          return [{ id: PERCEPTION_JOB_ID, status: "PROCESSING", job_type: "ANALYZE_VIDEO", job_revision: 2,
            attempt: 1, lease_owner: "worker-1", lease_token_hash: Buffer.from([1, 2, 3]), lease_until: leaseUntil,
            analysis_id: PERCEPTION_ANALYSIS_ID, source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
            content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"), expires_at: expiresAt }];
        }
        if (query.sql.includes("select id") && query.sql.includes("incident_candidates")) {
          return [{ id: "55555555-5555-4555-8555-555555555555" }];
        }
        return [];
      },
    }) } } as never, () => {
      expect(lockReturned).toBe(true);
      return new Date("2026-09-03T00:00:00.080Z");
    });
    const value = await repository.result({
      jobId: PERCEPTION_JOB_ID, workerId: "worker-1", jobRevision: 2,
      leaseTokenHash: Uint8Array.from([1, 2, 3]), now: "2026-09-03T00:00:00.000Z", payload,
      perceptionVerification: { analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        admission: { status: "NOT_ADMITTED", reasons: ["CONTACT_METHOD_NOT_VERIFIED"] } },
    });

    expect(value).toEqual(expected);
    if (value.kind === "ACCEPTED") {
      const completion = queries.find((query) => query.sql.includes("update analyses"));
      expect(completion?.params).toContain("2026-09-03T00:00:00.080Z");
    } else {
      expect(queries).toHaveLength(1);
    }
  });

  it("rejects a private summary envelope larger than 1 MiB before opening a transaction", async () => {
    let transactions = 0;
    const repository = new JobStore({ db: { transaction: async () => {
      transactions += 1;
      return [{ kind: "ACCEPTED" }];
    } } } as never);
    const payload = perceptionPayload();

    await expect(repository.result({
      jobId: PERCEPTION_JOB_ID, workerId: "worker-1", jobRevision: 2,
      leaseTokenHash: Uint8Array.from([1, 2, 3]), now: "2026-09-03T00:00:00.000Z", payload,
      perceptionVerification: { analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        admission: { status: "NOT_ADMITTED", reasons: ["x".repeat(1_048_576)] } },
    })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });
    expect(transactions).toBe(0);
  });
});
