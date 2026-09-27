import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusStore } from "@replay/adapters";
import { client } from "@replay/database";

// 별도 시험 데이터베이스에서 처리 중 분석 상태의 조회 시점 파생 확인
describe.skipIf(!process.env.DATABASE_URL)("처리 중 분석 상태", () => {
    // 데이터베이스 시험용 연결 준비
    const database = process.env.DATABASE_URL ? client() : null;
    // 연결이 없으면 시험 구성 중단
    if (!database) return;
    // 상태 조회 저장소 준비
    const status = statusStore(database);
    // 현재 시각과 만료 시각 준비
    const now = "2026-09-05T00:00:00.000Z";
    const expires = "2026-09-06T00:00:00.000Z";
    // 내용 해시 계산
    const hash = (value: string) => createHash("sha256").update(value).digest();
    // 시험별 세션과 영상 및 분석 식별자 보관 변수 생성
    let session: string;
    let video: string;
    let analysis: string;

    beforeEach(async () => {
        // 시험별 소유 세션과 대기 분석 생성
        session = randomUUID();
        video = randomUUID();
        analysis = randomUUID();
        await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session}, ${hash(session)}, ${now}, ${expires})`;
        await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video}, ${session}, ${video}, ${hash(video)}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
        await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, created_at, expires_at) values (${analysis}, ${session}, ${video}, 'QUEUED', 'TEMPORARY', ${now}, ${expires})`;
    });
    afterEach(async () => {
        // 시험 자료 삭제
        await database.sql`delete from analyses where anonymous_session_id = ${session}`;
        await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
        await database.sql`delete from anonymous_sessions where id = ${session}`;
    });
    afterAll(() => database.close());

    // 대기 또는 임대 중인 분석 작업 한 건 삽입
    const job = (state: "QUEUED" | "PROCESSING") => {
        // 임대 중인 작업 여부
        const leased = state === "PROCESSING";
        // 작업 상태에 맞는 임대와 단계 및 진행률 기록
        return database.sql`
          insert into processing_jobs (
            id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts,
            lease_owner, lease_token_hash, lease_until, stage, progress_percent, created_at, updated_at
          ) values (
            ${randomUUID()}, ${analysis}, 'ANALYZE_VIDEO', ${state}::job_status, 1, 1, ${leased ? 1 : 0}, 3,
            ${leased ? "worker" : null}, ${leased ? hash("lease") : null}, ${leased ? expires : null},
            ${leased ? "DETECTING" : "QUEUED"}::job_stage, ${leased ? 40 : 0}, ${now}, ${now}
          )`;
    };

    it.each([["QUEUED", "QUEUED"], ["PROCESSING", "DETECTING"]] as const)(
        "reports a %s analysis job as %s without rewriting the stored analysis",
        async (state, expected) => {
            await job(state);
            // 소유자 상태 조회의 분석 상태가 작업 단계를 따르는지 확인
            const view = await status.status({ anonymousSessionId: session, videoAssetId: video, now });
            expect(view?.analysis?.status).toBe(expected);
            // 저장된 분석 기록은 최종 전이 전까지 대기 상태로 유지되는지 확인
            const [row] = await database.sql<{ status: string }[]>`select status from analyses where id = ${analysis}`;
            expect(row?.status).toBe("QUEUED");
        }
    );
});
