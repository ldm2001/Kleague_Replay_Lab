// 작업 저장소 통합 테스트
import { createHash as digest, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { jobStore } from "@replay/adapters";
import { client } from "@replay/database";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const NOW = "2030-01-01T12:00:00.000Z";
const LEASE = "2030-01-01T12:01:00.000Z";

describeDatabase("PostgreSQL job result repository", () => {
  const database = databaseUrl ? client(databaseUrl) : null;
  if (!database) return;
  const repository = jobStore(database);
  const sessions: string[] = [];

  beforeAll(async () => {
    await database.sql`select 1`;
  });

  afterEach(async () => {
    for (const sessionId of sessions.splice(0)) {
      await database.sql`delete from analyses where anonymous_session_id = ${sessionId}`;
      await database.sql`delete from processing_jobs where video_asset_id in (select id from video_assets where anonymous_session_id = ${sessionId})`;
      await database.sql`delete from video_assets where anonymous_session_id = ${sessionId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });

  afterAll(async () => {
    await database.close();
  });

  it("accepts one current validation result and rejects its replay", async () => {
    const sessionId = randomUUID();
    const assetId = randomUUID();
    const jobId = randomUUID();
    sessions.push(sessionId);
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
    await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1, 2, 3])}, 'video/mp4',
        100, 'VALIDATING', 0, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
    await database.sql`
      insert into processing_jobs (
        id, video_asset_id, job_type, status, payload_version, max_attempts, created_at, updated_at
      ) values (${jobId}, ${assetId}, 'VALIDATE_VIDEO', 'QUEUED', 1, 3, ${NOW}, ${NOW})
    `;

    const claim = await repository.claim({
      workerId: "worker-1",
      jobType: "VALIDATE_VIDEO",
      now: NOW,
      leaseUntil: LEASE,
    });
    expect(claim?.jobId).toBe(jobId);
    const leaseTokenHash = Uint8Array.from(digest("sha256").update(claim!.leaseToken).digest());
    await expect(repository.progress({
      jobId,
      workerId: "worker-1",
      jobRevision: claim!.jobRevision,
      leaseTokenHash,
      stage: "VALIDATING",
      progressPercent: 10,
      now: "2030-01-01T12:00:05.000Z",
      leaseUntil: "2030-01-01T12:01:05.000Z",
      message: "worker-started",
    })).resolves.toMatchObject({ kind: "UPDATED", progressPercent: 10 });
    const command = {
      jobId,
      workerId: "worker-1",
      jobRevision: claim!.jobRevision,
      leaseTokenHash,
      now: "2030-01-01T12:00:10.000Z",
      payload: { kind: "VALIDATED" as const, durationMs: 90_000, width: 1920, height: 1080 },
    };

    await expect(repository.result(command)).resolves.toEqual({ kind: "ACCEPTED" });
    await expect(repository.result(command)).resolves.toEqual({ kind: "ALREADY_FINISHED" });

    const [asset] = await database.sql<{ status: string; duration_ms: number; width: number; height: number }[]>`
      select status, duration_ms, width, height from video_assets where id = ${assetId}
    `;
    const [job] = await database.sql<{ status: string; stage: string; progress_percent: number }[]>`
      select status, stage, progress_percent from processing_jobs where id = ${jobId}
    `;
    const events = await database.sql<{ event_type: string }[]>`
      select event_type from processing_job_events where job_id = ${jobId} order by created_at
    `;
    const [analysis] = await database.sql<{ id: string; status: string }[]>`
      select id, status from analyses where video_asset_id = ${assetId}
    `;
    const [analysisJob] = await database.sql<{ job_type: string; status: string }[]>`
      select job_type, status from processing_jobs where analysis_id = ${analysis?.id ?? null}
    `;
    expect(asset).toEqual({ status: "VALID", duration_ms: 90_000, width: 1920, height: 1080 });
    expect(job).toEqual({ status: "SUCCEEDED", stage: "SUCCEEDED", progress_percent: 100 });
    expect(events.map((event) => event.event_type)).toEqual(["CLAIMED", "PROGRESS", "SUCCEEDED"]);
    expect(analysis?.status).toBe("QUEUED");
    expect(analysisJob).toEqual({ job_type: "ANALYZE_VIDEO", status: "QUEUED" });

    const [analysisTarget] = await database.sql<{ id: string }[]>`
      select id from processing_jobs where analysis_id = ${analysis!.id} and job_type = 'ANALYZE_VIDEO'
    `;
    const analysisLease = Uint8Array.from(digest("sha256").update("analysis-lease").digest());
    await database.sql`
      update processing_jobs
      set status = 'PROCESSING', stage = 'SEGMENTING', job_revision = 1, attempt = 1,
          lease_owner = 'worker-1', lease_token_hash = ${Buffer.from(analysisLease)},
          lease_until = '2030-01-01T12:01:20.000Z'
      where id = ${analysisTarget!.id}
    `;
    await expect(repository.result({
      jobId: analysisTarget!.id,
      workerId: "worker-1",
      jobRevision: 1,
      leaseTokenHash: analysisLease,
      now: "2030-01-01T12:00:30.000Z",
      payload: {
        kind: "ANALYZED",
        pipelineVersion: "video-baseline-v1",
        limitations: ["incident_category_classification_pending"],
        shots: [{ index: 0, startMs: 0, endMs: 4000, playbackSpeed: "UNKNOWN", isReplay: false, cameraAngle: null }],
        candidates: [{
          index: 1,
          category: "OTHER",
          startMs: 500,
          endMs: 1500,
          anchorMs: 1000,
          confidence: 0.42,
          cameraSufficiency: "MEDIUM",
          reasons: ["motion-spike"],
          shotIndices: [0],
        }],
        evidence: [{
          candidateIndex: 1,
          kind: "FRAME" as const,
          objectKey: `evidence/${analysis!.id}/${analysisTarget!.id}/candidate-0001.jpg`,
          contentSha256: "01".repeat(32),
          startMs: 500,
          endMs: 1500,
          width: 1920,
          height: 1080,
        }],
      },
    })).resolves.toEqual({ kind: "ACCEPTED" });

    const [completed] = await database.sql<{ status: string; pipeline_version: string; completed_at: string }[]>`
      select status, pipeline_version, completed_at from analyses where id = ${analysis!.id}
    `;
    const storedShots = await database.sql<{ shot_index: number }[]>`
      select shot_index from shots where analysis_id = ${analysis!.id}
    `;
    const storedCandidates = await database.sql<{ candidate_index: number; detection_confidence: number }[]>`
      select candidate_index, detection_confidence from incident_candidates where analysis_id = ${analysis!.id}
    `;
    const storedEvidence = await database.sql<{ kind: string; object_key: string }[]>`
      select kind, object_key from evidence_assets where analysis_id = ${analysis!.id}
    `;
    expect(completed?.status).toBe("CANDIDATES_READY");
    expect(completed?.pipeline_version).toBe("video-baseline-v1");
    expect(completed?.completed_at).toBeNull();
    expect(storedShots).toEqual([{ shot_index: 0 }]);
    expect(storedCandidates).toEqual([{ candidate_index: 1, detection_confidence: 0.42 }]);
    expect(storedEvidence).toEqual([{
      kind: "FRAME",
      object_key: `evidence/${analysis!.id}/${analysisTarget!.id}/candidate-0001.jpg`,
    }]);
  });

  it("reclaims an expired processing lease", async () => {
    const sessionId = randomUUID();
    const assetId = randomUUID();
    const jobId = randomUUID();
    sessions.push(sessionId);
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
    await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])}, 'video/mp4',
        100, 'VALIDATING', 0, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
    await database.sql`
      insert into processing_jobs (
        id, video_asset_id, job_type, status, payload_version, job_revision, attempt,
        max_attempts, lease_owner, lease_token_hash, lease_until, stage, created_at, updated_at
      ) values (
        ${jobId}, ${assetId}, 'DELETE_VIDEO_ASSET', 'PROCESSING', 1, 1, 1, 3,
        'old-worker', ${Buffer.from([2])}, '2030-01-01T11:59:00.000Z', 'VALIDATING',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
      )
    `;

    const claimed = await repository.claim({
      workerId: "new-worker",
      jobType: "DELETE_VIDEO_ASSET",
      now: NOW,
      leaseUntil: LEASE,
    });

    expect(claimed).toMatchObject({ jobId, jobRevision: 2, attempt: 2 });
  });

  it("marks an analysis failed for an accepted worker failure", async () => {
    const sessionId = randomUUID();
    const assetId = randomUUID();
    const analysisId = randomUUID();
    const jobId = randomUUID();
    const token = Uint8Array.from(digest("sha256").update("analysis-failure").digest());
    sessions.push(sessionId);
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
    await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])}, 'video/mp4',
        100, 'VALID', 1, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
    await database.sql`
      insert into analyses (
        id, anonymous_session_id, video_asset_id, status, retention_class,
        state_version, created_at, expires_at
      ) values (
        ${analysisId}, ${sessionId}, ${assetId}, 'QUEUED', 'TEMPORARY', 0,
        ${NOW}, '2030-01-02T12:00:00.000Z'
      )
    `;
    await database.sql`
      insert into processing_jobs (
        id, analysis_id, job_type, status, payload_version, job_revision, attempt,
        max_attempts, lease_owner, lease_token_hash, lease_until, stage, created_at, updated_at
      ) values (
        ${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3,
        'worker-1', ${Buffer.from(token)}, ${LEASE}, 'SEGMENTING', ${NOW}, ${NOW}
      )
    `;

    await expect(repository.result({
      jobId,
      workerId: "worker-1",
      jobRevision: 1,
      leaseTokenHash: token,
      now: "2030-01-01T12:00:10.000Z",
      payload: { kind: "FAILED", failureCode: "PIPELINE_ERROR", retryable: false },
    })).resolves.toEqual({ kind: "ACCEPTED" });

    const [analysis] = await database.sql<{ status: string; failure_code: string }[]>`
      select status, failure_code from analyses where id = ${analysisId}
    `;
    expect(analysis).toEqual({ status: "FAILED", failure_code: "PIPELINE_ERROR" });
  });
});
