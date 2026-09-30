import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { statusStore } from "@replay/adapters";
import { client } from "@replay/database";

// 별도 시험 데이터베이스에서 분석 기원 자료의 세 조회 경로가 같은 보존 규칙을 따르는지 확인
describe.skipIf(!process.env.DATABASE_URL)("분석 보존 기한", () => {
    // 데이터베이스 시험용 연결 준비
    const database = process.env.DATABASE_URL ? client() : null;
    // 연결이 없으면 시험 구성 중단
    if (!database) return;
    // 상태 조회 저장소 준비
    const store = statusStore(database);
    // 생성 시각과 조회 시각 및 조회 전 만료 시각과 기본 만료 시각 준비
    const created = "2026-09-05T00:00:00.000Z";
    const now = "2026-09-05T02:00:00.000Z";
    const past = "2026-09-05T01:00:00.000Z";
    const expires = "2026-09-06T00:00:00.000Z";
    // 내용 해시 계산
    const hash = (value: string) => createHash("sha256").update(value).digest();
    // 시험별 세션과 영상 및 분석과 증거 식별자 보관 변수 생성
    let session: string;
    let video: string;
    let analysis: string;
    let evidence: string;

    beforeEach(async () => {
        // 시험별 식별자 생성
        session = randomUUID();
        video = randomUUID();
        analysis = randomUUID();
        evidence = randomUUID();
        const candidate = randomUUID();
        // 보존 기한 안의 소유 세션과 영상 및 분석과 후보 증거 생성
        await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session}, ${hash(session)}, ${created}, ${expires})`;
        await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video}, ${session}, ${video}, ${hash(video)}, 'video/mp4', 100, 'VALID', ${created}, ${created}, ${expires})`;
        await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, created_at, expires_at) values (${analysis}, ${session}, ${video}, 'CANDIDATES_READY', 'TEMPORARY', ${created}, ${expires})`;
        await database.sql`insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, camera_sufficiency, review_status) values (${candidate}, ${analysis}, 1, 'OTHER', 0, 2000, 'HIGH', 'UNREVIEWED')`;
        await database.sql`insert into evidence_assets (id, analysis_id, incident_candidate_id, kind, object_key, content_sha256, start_ms, end_ms, created_at, expires_at) values (${evidence}, ${analysis}, ${candidate}, 'FRAME', ${evidence}, ${hash(evidence)}, 1000, 1000, ${created}, ${expires})`;
    });
    afterEach(async () => {
        // 분석 삭제로 후보와 증거까지 연쇄 삭제한 뒤 영상과 세션 삭제
        await database.sql`delete from analyses where anonymous_session_id = ${session}`;
        await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
        await database.sql`delete from anonymous_sessions where id = ${session}`;
    });
    afterAll(() => database.close());

    // 상태와 분석 결과 및 증거 파일 조회 경로의 결과 일괄 조회
    const read = async () => ({
        status: await store.status({ anonymousSessionId: session, videoAssetId: video, now }),
        analysis: await store.analysis({ anonymousSessionId: session, analysisId: analysis, now }),
        media: await store.media({
            anonymousSessionId: session,
            analysisId: analysis,
            evidenceId: evidence,
            now
        })
    });

    it("serves the analysis and its evidence while every retention holds", async () => {
        // 세 조회 경로 결과 조회
        const result = await read();
        // 상태 조회의 분석 원자료 확인
        expect(result.status?.analysis?.analysisId).toBe(analysis);
        // 분석 결과 조회의 분석 원자료 확인
        expect(result.analysis?.analysis?.analysisId).toBe(analysis);
        // 증거 파일 접근 정보 확인
        expect(result.media).toEqual({ objectKey: evidence, contentType: "image/jpeg" });
    });

    it("hides an analysis past its own retention even while the source video remains", async () => {
        // 영상보다 먼저 끝나는 분석 보존 기한 기록
        await database.sql`update analyses set expires_at = ${past} where id = ${analysis}`;
        // 세 조회 경로 결과 조회
        const result = await read();
        // 영상은 남고 만료된 분석 원자료는 상태 조회에서 제외됨 확인
        expect(result.status).toMatchObject({ videoAssetId: video, analysis: null });
        // 분석 결과와 증거 파일 조회 차단 확인
        expect(result).toMatchObject({ analysis: null, media: null });
    });

    it.each([
        ["object deletion", "object_deleted_at"],
        ["retention expiry", "expires_at"]
    ] as const)(
        "stops serving the analysis and evidence after source video %s",
        async (_, column) => {
            // 원본 영상 객체 삭제 또는 보존 기한 종료 기록
            await database.sql`update video_assets set ${database.sql(column)} = ${past} where id = ${video}`;
            // 세 조회 경로 결과 조회
            const result = await read();
            // 세 조회 경로 모두 차단 확인
            expect(result).toEqual({ status: null, analysis: null, media: null });
        }
    );

    it("fails closed for a source video recorded without a retention expiry", async () => {
        // 원본 영속 금지 제약을 어긴 기한 없는 원본 영상 기록
        await database.sql`update video_assets set expires_at = null where id = ${video}`;
        // 세 조회 경로 결과 조회
        const result = await read();
        // 기한 없는 원본과 그 기원 분석 및 증거 모두 차단 확인
        expect(result).toEqual({ status: null, analysis: null, media: null });
    });
});
