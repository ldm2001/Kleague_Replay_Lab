import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { jobStore } from "@replay/adapters";
import { client } from "@replay/database";

// Lease 갱신과 마지막 시도 종료 검증
describe.skipIf(!process.env.DATABASE_URL)("작업 수명", () => {
  const database = process.env.DATABASE_URL ? client() : null;
  if (!database) return;
  const store = jobStore(database);
  const sessions: string[] = [];
  const now = "2026-09-05T00:00:00.000Z";
  const lease = "2026-09-05T00:01:00.000Z";
  const hash = createHash("sha256").update("lease-test").digest();

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await database.sql`delete from analyses where anonymous_session_id = ${session}`;
      await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
      await database.sql`delete from anonymous_sessions where id = ${session}`;
    }
  });
  afterAll(() => database.close());

  const fixture = async (kind: "VALIDATE_VIDEO" | "ANALYZE_VIDEO", until: string, attempt: number) => {
    // 다른 작업과 분리된 세션 생성
    const [session, video, analysis, job] = Array.from({ length: 4 }, () => randomUUID());
    sessions.push(session!);
    await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session!}, ${Buffer.from(session!)}, ${now}, '2026-09-06')`;
    await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video!}, ${session!}, ${video!}, ${hash}, 'video/mp4', 100, ${kind === "ANALYZE_VIDEO" ? "VALID" : "VALIDATING"}, ${now}, ${now}, '2026-09-06')`;
    if (kind === "ANALYZE_VIDEO") {
      await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, created_at, expires_at) values (${analysis!}, ${session!}, ${video!}, 'QUEUED', 'TEMPORARY', ${now}, '2026-09-06')`;
    }
    await database.sql`insert into processing_jobs (id, video_asset_id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, stage, progress_percent, created_at, updated_at) values (${job!}, ${kind === "VALIDATE_VIDEO" ? video! : null}, ${kind === "ANALYZE_VIDEO" ? analysis! : null}, ${kind}, 'PROCESSING', 1, 1, ${attempt}, 3, 'review-worker', ${hash}, ${until}, 'BUILDING_EVIDENCE', 70, ${now}, ${now})`;
    return { video: video!, analysis: analysis!, job: job! };
  };

  it("늦은 진행 보고", async () => {
    const { job } = await fixture("ANALYZE_VIDEO", lease, 1);
    const request = { jobId: job, workerId: "review-worker", jobRevision: 1, leaseTokenHash: hash, stage: "SEGMENTING" as const, progressPercent: 10, now, leaseUntil: lease, message: "worker-heartbeat" };
    expect(await store.progress(request)).toMatchObject({ kind: "UPDATED", stage: "BUILDING_EVIDENCE", progressPercent: 70 });
    // 다른 Lease 소유자의 보고는 거절
    expect(await store.progress({ ...request, workerId: "other" })).toEqual({ kind: "STALE_LEASE" });
  });

  it.each(["VALIDATE_VIDEO", "ANALYZE_VIDEO"] as const)("마지막 시도 만료 %s", async (kind) => {
    const target = await fixture(kind, "2026-09-04T23:59:00Z", 3);
    await store.claim({ workerId: "new-worker", jobType: kind, now, leaseUntil: lease });
    const [job] = await database.sql`select status, failure_code, lease_owner from processing_jobs where id = ${target.job}`;
    expect(job).toEqual({ status: "FAILED", failure_code: "WORKER_TIMEOUT", lease_owner: null });
    const events = await database.sql`select event_type from processing_job_events where job_id = ${target.job}`;
    expect(events).toEqual([{ event_type: "FAILED" }]);
    if (kind === "ANALYZE_VIDEO") {
      const [analysis] = await database.sql`select status, state_version from analyses where id = ${target.analysis}`;
      expect(analysis).toEqual({ status: "FAILED", state_version: 1 });
    } else {
      const [video] = await database.sql`select status, validation_error_code from video_assets where id = ${target.video}`;
      expect(video).toEqual({ status: "REJECTED", validation_error_code: "WORKER_TIMEOUT" });
    }
    // 다음 조회에서도 실패 로그를 중복 생성하지 않음
    await store.claim({ workerId: "new-worker", jobType: kind, now, leaseUntil: lease });
    expect(await database.sql`select id from processing_job_events where job_id = ${target.job}`).toHaveLength(1);
  });

  it("유효한 마지막 Lease", async () => {
    const { job } = await fixture("ANALYZE_VIDEO", lease, 3);
    await store.claim({ workerId: "new-worker", jobType: "ANALYZE_VIDEO", now, leaseUntil: lease });
    const [row] = await database.sql`select status from processing_jobs where id = ${job}`;
    expect(row?.status).toBe("PROCESSING");
  });
});
