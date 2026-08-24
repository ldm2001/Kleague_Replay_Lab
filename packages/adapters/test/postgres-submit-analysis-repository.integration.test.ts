import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SubmitAnalysisCommand, SubmitAnalysisRepositoryResult } from "@replay/application";
import { createDatabaseClient } from "@replay/database";
import { createPostgresSubmitAnalysisRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

type Seed = {
  sessionId: string;
  videoId: string;
  matchId: string;
  ruleId: string;
};

const createdAt = "2030-01-01T12:00:00.000Z";
const expiresAt = "2030-01-02T12:00:00.000Z";
const seedCreatedAt = "2029-01-01T12:00:00.000Z";

describeDatabase("PostgreSQL submit-analysis repository", () => {
  const client = databaseUrl ? createDatabaseClient(databaseUrl) : null;
  if (!client) return;

  const repository = createPostgresSubmitAnalysisRepository(client);
  const seeds: Seed[] = [];

  beforeAll(async () => {
    await client.sql`select 1`;
  });

  afterEach(async () => {
    for (const seed of seeds.splice(0)) {
      await client.sql`delete from analyses where anonymous_session_id = ${seed.sessionId}`;
      await client.sql`delete from video_assets where id = ${seed.videoId}`;
      await client.sql`delete from competition_rule_versions where id = ${seed.ruleId}`;
      await client.sql`delete from matches where id = ${seed.matchId}`;
      await client.sql`delete from anonymous_sessions where id = ${seed.sessionId}`;
    }
  });

  afterAll(async () => {
    await client.close();
  });

  const seedScenario = async (overrides: {
    sessionExpiresAt?: string;
    sessionRevokedAt?: string | null;
    videoSessionId?: string;
    videoStatus?: string;
    videoExpiresAt?: string | null;
    rightsConfirmedAt?: string | null;
    objectDeletedAt?: string | null;
    withRule?: boolean;
  } = {}): Promise<Seed> => {
    const suffix = randomUUID().replaceAll("-", "");
    const seed: Seed = {
      sessionId: randomUUID(),
      videoId: randomUUID(),
      matchId: randomUUID(),
      ruleId: randomUUID(),
    };
    seeds.push(seed);

    await client.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at, revoked_at)
      values (
        ${seed.sessionId},
        ${Buffer.from(`submit-analysis-token-${suffix}`)},
        ${seedCreatedAt},
        ${overrides.sessionExpiresAt ?? expiresAt},
        ${overrides.sessionRevokedAt ?? null}
      )
    `;

    const videoSessionId = overrides.videoSessionId ?? seed.sessionId;
    await client.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, rights_confirmed_at, created_at, expires_at, object_deleted_at
      )
      values (
        ${seed.videoId},
        ${videoSessionId},
        ${`submit-analysis-${suffix}.mp4`},
        ${Buffer.from(`submit-analysis-content-${suffix}`)},
        'video/mp4',
        100,
        ${overrides.videoStatus ?? "VALID"},
        ${overrides.rightsConfirmedAt === undefined ? createdAt : overrides.rightsConfirmedAt},
        ${seedCreatedAt},
        ${overrides.videoExpiresAt === undefined ? expiresAt : overrides.videoExpiresAt},
        ${overrides.objectDeletedAt ?? null}
      )
    `;

    await client.sql`
      insert into matches (id, competition, season, match_date)
      values (${seed.matchId}, ${`Submit Analysis Cup ${suffix}`}, '2030', '2030-01-01')
    `;

    if (overrides.withRule !== false) {
      await client.sql`
        insert into competition_rule_versions (
          id, competition, season, effective_from, effective_to,
          ifab_edition, source_document, verification_status
        )
        select
          ${seed.ruleId}, competition, season, '2029-01-01', null,
          '2029/30', 'submit-analysis-test', 'VERIFIED'
        from matches
        where id = ${seed.matchId}
      `;
    }

    return seed;
  };

  const commandFor = (
    seed: Seed,
    overrides: Partial<SubmitAnalysisCommand> = {},
  ): SubmitAnalysisCommand => ({
    anonymousSessionId: seed.sessionId,
    videoAssetId: seed.videoId,
    matchId: seed.matchId,
    sourceUrl: null,
    sourcePlatform: null,
    keyHash: Uint8Array.from([1, 2, 3, 4]),
    requestHash: Uint8Array.from([5, 6, 7, 8]),
    createdAt,
    expiresAt,
    pipelineVersion: "pipeline-test-v1",
    mediaPolicyVersion: "media-test-v1",
    jobPayloadVersion: 7,
    maxJobAttempts: 4,
    ...overrides,
  });

  const countRows = async (seed: Seed) => {
    const [analysisCount] = await client.sql<{ count: string }[]>`
      select count(*)::text as count from analyses where anonymous_session_id = ${seed.sessionId}
    `;
    const [jobCount] = await client.sql<{ count: string }[]>`
      select count(*)::text as count
      from processing_jobs
      where analysis_id in (select id from analyses where anonymous_session_id = ${seed.sessionId})
    `;
    const [idempotencyCount] = await client.sql<{ count: string }[]>`
      select count(*)::text as count from idempotency_records where anonymous_session_id = ${seed.sessionId}
    `;
    return {
      analyses: Number(analysisCount?.count ?? 0),
      jobs: Number(jobCount?.count ?? 0),
      idempotency: Number(idempotencyCount?.count ?? 0),
    };
  };

  it("creates a queued analysis, job, and idempotency record with persisted command values", async () => {
    const seed = await seedScenario();

    const result = await repository.submit(commandFor(seed));

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") return;

    const [analysis] = await client.sql<{
      id: string;
      status: string;
      retention_class: string;
      source_fingerprint: Buffer;
      applied_rule_version_id: string;
      pipeline_version: string;
      media_policy_version: string;
      state_version: number;
      created_at: string;
      expires_at: string;
    }[]>`select * from analyses where id = ${result.analysisId}`;
    const [job] = await client.sql<{
      job_type: string;
      status: string;
      payload_version: number;
      job_revision: number;
      attempt: number;
      max_attempts: number;
      next_attempt_at: string;
    }[]>`select * from processing_jobs where analysis_id = ${result.analysisId}`;
    const [idempotency] = await client.sql<{
      operation: string;
      key_hash: Buffer;
      request_hash: Buffer;
      created_at: string;
      expires_at: string;
    }[]>`select * from idempotency_records where analysis_id = ${result.analysisId}`;

    expect(analysis).toMatchObject({
      id: result.analysisId,
      status: "QUEUED",
      retention_class: "TEMPORARY",
      applied_rule_version_id: seed.ruleId,
      pipeline_version: "pipeline-test-v1",
      media_policy_version: "media-test-v1",
      state_version: 0,
    });
    expect(new Date(analysis!.created_at).toISOString()).toBe(createdAt);
    expect(new Date(analysis!.expires_at).toISOString()).toBe(expiresAt);
    expect(analysis?.source_fingerprint).toEqual(expect.any(Buffer));
    expect(job).toMatchObject({
      job_type: "ANALYZE_VIDEO",
      status: "QUEUED",
      payload_version: 7,
      job_revision: 0,
      attempt: 0,
      max_attempts: 4,
    });
    expect(new Date(job!.next_attempt_at).toISOString()).toBe(createdAt);
    expect(idempotency).toMatchObject({
      operation: "CREATE_ANALYSIS",
    });
    expect(new Date(idempotency!.created_at).toISOString()).toBe(createdAt);
    expect(new Date(idempotency!.expires_at).toISOString()).toBe(expiresAt);
    expect(idempotency?.key_hash).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(idempotency?.request_hash).toEqual(Buffer.from([5, 6, 7, 8]));
    expect(await countRows(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
  });

  it("replays the same request and rejects a different request under the same key", async () => {
    const seed = await seedScenario();
    const command = commandFor(seed);

    const created = await repository.submit(command);
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;

    const replayed = await repository.submit(command);
    expect(replayed).toEqual({ kind: "REPLAYED", analysisId: created.analysisId });
    expect(await countRows(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });

    await client.sql`
      update idempotency_records
      set expires_at = '2030-01-01T12:00:01.000Z'
      where anonymous_session_id = ${seed.sessionId}
    `;
    const expiredRowReplay = await repository.submit(command);
    expect(expiredRowReplay).toEqual({ kind: "REPLAYED", analysisId: created.analysisId });

    const conflict = await repository.submit({
      ...command,
      requestHash: Uint8Array.from([8, 7, 6, 5]),
    });
    expect(conflict).toEqual({ kind: "IDEMPOTENCY_KEY_REUSED" });
    expect(await countRows(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
  });

  it("returns VIDEO_ASSET_UNAVAILABLE for invalid session or video ownership state", async () => {
    const invalidStates: Array<{
      name: string;
      overrides: Parameters<typeof seedScenario>[0];
      extraSession?: boolean;
    }> = [
      { name: "expired session", overrides: { sessionExpiresAt: "2030-01-01T11:59:59.000Z" } },
      { name: "revoked session", overrides: { sessionRevokedAt: "2030-01-01T11:00:00.000Z" } },
      { name: "rejected video", overrides: { videoStatus: "REJECTED" } },
      { name: "expired video", overrides: { videoExpiresAt: "2030-01-01T11:59:59.000Z" } },
      { name: "deleted object", overrides: { objectDeletedAt: "2030-01-01T11:00:00.000Z" } },
      { name: "unconfirmed rights", overrides: { rightsConfirmedAt: null } },
    ];

    for (const [index, state] of invalidStates.entries()) {
      const seed = await seedScenario(state.overrides);
      const result = await repository.submit(
        commandFor(seed, {
          keyHash: Uint8Array.from([10, index + 1]),
          requestHash: Uint8Array.from([20, index + 1]),
        }),
      );
      expect(result, state.name).toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
      expect(await countRows(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
    }

    const owner = await seedScenario();
    const otherSession = await seedScenario();
    await client.sql`
      update video_assets set anonymous_session_id = ${otherSession.sessionId} where id = ${owner.videoId}
    `;
    const otherSessionResult = await repository.submit(
      commandFor(owner, { keyHash: Uint8Array.from([11, 1]), requestHash: Uint8Array.from([21, 1]) }),
    );
    expect(otherSessionResult).toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
  });

  it("re-checks a video after waiting for a concurrent status update", async () => {
    const seed = await seedScenario();
    let releaseHolder: (() => void) | undefined;
    let signalLocked: (() => void) | undefined;
    const holderMayUpdate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holderLocked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const holder = client.sql.begin(async (transaction) => {
      await transaction`select id from video_assets where id = ${seed.videoId} for update`;
      signalLocked?.();
      await holderMayUpdate;
      await transaction`update video_assets set status = 'REJECTED' where id = ${seed.videoId}`;
    });
    await holderLocked;

    const submitting = repository.submit(
      commandFor(seed, { keyHash: Uint8Array.from([71, 72]), requestHash: Uint8Array.from([81, 82]) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseHolder?.();
    await holder;

    await expect(submitting).resolves.toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
    expect(await countRows(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
  });

  it("returns MATCH_UNAVAILABLE when the requested match is absent", async () => {
    const seed = await seedScenario();

    const result = await repository.submit(
      commandFor(seed, { matchId: randomUUID() }),
    );

    expect(result).toEqual({ kind: "MATCH_UNAVAILABLE" });
    expect(await countRows(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
  });

  it("returns RULE_VERSION_UNAVAILABLE when no rule applies to the match date", async () => {
    const seed = await seedScenario({ withRule: false });

    const result = await repository.submit(commandFor(seed));

    expect(result).toEqual({ kind: "RULE_VERSION_UNAVAILABLE" });
    expect(await countRows(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
  });

  it("maps only the duplicate video constraint to VIDEO_ASSET_ALREADY_SUBMITTED", async () => {
    const seed = await seedScenario();
    const first = await repository.submit(commandFor(seed));
    expect(first.kind).toBe("CREATED");

    const duplicate = await repository.submit(
      commandFor(seed, {
        keyHash: Uint8Array.from([31, 32, 33]),
        requestHash: Uint8Array.from([41, 42, 43]),
      }),
    );

    expect(duplicate).toEqual({ kind: "VIDEO_ASSET_ALREADY_SUBMITTED" });
    expect(await countRows(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
  });

  it("rolls back analysis and idempotency writes when the job insert fails", async () => {
    const seed = await seedScenario();

    await expect(
      repository.submit(commandFor(seed, { maxJobAttempts: 0 })),
    ).rejects.toThrow();

    expect(await countRows(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
  });

  it("converges concurrent submissions for the same key to CREATED and REPLAYED", async () => {
    const seed = await seedScenario();
    const command = commandFor(seed, {
      keyHash: Uint8Array.from([51, 52, 53]),
      requestHash: Uint8Array.from([61, 62, 63]),
    });

    const results = await Promise.all([repository.submit(command), repository.submit(command)]);

    expect(results.map((result) => result.kind).sort()).toEqual(["CREATED", "REPLAYED"]);
    const analysisIds = results
      .filter((result): result is Extract<SubmitAnalysisRepositoryResult, { kind: "CREATED" | "REPLAYED" }> =>
        result.kind === "CREATED" || result.kind === "REPLAYED",
      )
      .map((result) => result.analysisId);
    expect(new Set(analysisIds).size).toBe(1);
    expect(await countRows(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
  });
});
