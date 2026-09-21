import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import type { JobResultCommand } from "@replay/application";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("automatic review storage", () => {
  if (!databaseUrl) return;
  const database = client(databaseUrl);
  afterAll(() => database.close());
  it("atomically stores blocked review with immutable evidence IDs, rejects stale bindings, and expires reads", async () => {
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    const source = randomBytes(32), lease = randomBytes(32);
    const now = "2030-01-01T00:00:00.000Z", expires = "2030-01-02T00:00:00.000Z";
    try {
      await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at) values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
      await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
      await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class, source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source}, 'video-baseline-v1', 'media-v1', ${now}, ${expires})`;
      await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'worker', ${lease}, ${expires}, ${now}, ${now})`;
      const command: JobResultCommand = {
        jobId, workerId: "worker", jobRevision: 1, leaseTokenHash: lease, now,
        payload: { kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [],
          candidates: [{ index: 0, category: "OTHER", startMs: 0, endMs: 1000, anchorMs: 500, confidence: 0.4, cameraSufficiency: "LOW", reasons: [], shotIndices: [] }],
          evidence: [{ candidateIndex: 0, kind: "FRAME", contentSha256: "a".repeat(64), objectKey: `evidence/${analysisId}/${jobId}/1/${"a".repeat(64)}/frame.jpg`, startMs: 500, endMs: 500, width: null, height: null }] },
        automaticReview: { version: "automatic-review-v1", analysisId, jobId, jobRevision: 1, sourceSha256: source.toString("hex"), pipelineVersion: "video-baseline-v1",
          videoCoverage: "PARTIAL", summaryTruncated: false, evaluatedCount: 0, blockedCount: 1,
          rows: [{ candidateIndex: 0, question: "PUSHING", status: "BLOCKED", reasonCodes: ["FACT_PRODUCER_UNVERIFIED"], evidenceIndices: [], producer: null, rule: null, facts: null, result: null }] },
      };
      const store = new JobStore(database, () => new Date(now));
      expect(await store.result({ ...command, automaticReview: { ...command.automaticReview!, jobRevision: 2 } })).toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });
      expect(await database.sql`select id from incident_candidates where analysis_id = ${analysisId}`).toHaveLength(0);
      expect(await store.result(command)).toEqual({ kind: "ACCEPTED" });
      const [saved] = await database.sql`select * from analysis_automatic_reviews where analysis_id = ${analysisId}`;
      expect(saved?.evidence_bindings).toMatchObject([{ evidenceIndex: 0, candidateIndex: 0, evidenceId: expect.any(String) }]);
      await expect(database.sql`update analysis_automatic_reviews set pipeline_version = 'tampered' where analysis_id = ${analysisId}`).rejects.toThrow("append-only");
      const status = new StatusStore(database);
      const view = await status.status({ anonymousSessionId: sessionId, videoAssetId: videoId, now });
      expect(view?.analysis?.automaticReviewSummary).toMatchObject({ completedCount: 0, blockedCount: 1 });
      expect(view?.analysis?.candidates).toEqual([]);
      await database.sql`update analyses set source_fingerprint = ${randomBytes(32)} where id = ${analysisId}`;
      expect((await status.status({ anonymousSessionId: sessionId, videoAssetId: videoId, now }))?.analysis?.automaticReviewSummary).toBeUndefined();
    } finally {
      await database.sql`delete from evidence_assets where analysis_id = ${analysisId}`;
      await database.sql`delete from incident_candidates where analysis_id = ${analysisId}`;
      await database.sql`delete from processing_job_events where job_id = ${jobId}`;
      await database.sql`delete from processing_jobs where id = ${jobId}`;
      await database.sql`delete from analyses where id = ${analysisId}`;
      await database.sql`delete from video_assets where id = ${videoId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });
});
