import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { jobStore } from "@replay/adapters";
import { client } from "@replay/database";

// 작업 임대 갱신과 마지막 시도 종료 검증
describe.skipIf(!process.env.DATABASE_URL)("작업 수명", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = process.env.DATABASE_URL ? client() : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;
    // 저장소 시험용 작업 저장소 결과 준비
    const store = jobStore(database);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];
    // 현재시각 시험용 2026 09 00 00 준비
    const now = "2026-09-05T00:00:00.000Z";
    // 임대 시험용 2026 09 01 00 준비
    const lease = "2026-09-05T00:01:00.000Z";
    // 해시 시험용 해시 결과 갱신 결과 해시 결과 준비
    const hash = createHash("sha256").update("lease-test").digest();

    afterEach(async () => {
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const session of sessions.splice(0)) {
            // 분석 삭제
            await database.sql`delete from analyses where anonymous_session_id = ${session}`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${session}`;
        }
    });
    afterAll(() => database.close());

    // 검증용 입력 모형 구성
    const fixture = async (
        kind: "VALIDATE_VIDEO" | "ANALYZE_VIDEO",
        until: string,
        attempt: number
    ) => {
        // 다른 작업과 분리된 세션 생성
        const [session, video, analysis, job] = Array.from({ length: 4 }, () => randomUUID());
        // 세션목록 추가 결과 처리 수행
        sessions.push(session!);
        // 익명 세션 삽입
        await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session!}, ${Buffer.from(session!)}, ${now}, '2026-09-06')`;
        // 영상 자산 삽입
        await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video!}, ${session!}, ${video!}, ${hash}, 'video/mp4', 100, ${kind === "ANALYZE_VIDEO" ? "VALID" : "VALIDATING"}, ${now}, ${now}, '2026-09-06')`;
        // 종류 비교 조건에 따른 처리 경로 분기
        if (kind === "ANALYZE_VIDEO") {
            // 분석 삽입
            await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, created_at, expires_at) values (${analysis!}, ${session!}, ${video!}, 'QUEUED', 'TEMPORARY', ${now}, '2026-09-06')`;
        }
        // 영상 처리 작업 삽입
        await database.sql`insert into processing_jobs (id, video_asset_id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, stage, progress_percent, created_at, updated_at) values (${job!}, ${kind === "VALIDATE_VIDEO" ? video! : null}, ${kind === "ANALYZE_VIDEO" ? analysis! : null}, ${kind}, 'PROCESSING', 1, 1, ${attempt}, 3, 'review-worker', ${hash}, ${until}, 'BUILDING_EVIDENCE', 70, ${now}, ${now})`;
        // 영상 및 분석 및 작업 자료 반환
        return { video: video!, analysis: analysis!, job: job! };
    };

    it("늦은 진행 보고", async () => {
        // 시험자료 결과를 작업에 저장
        const { job } = await fixture("ANALYZE_VIDEO", lease, 1);
        // 요청 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 및 작업 개정번호 1 및 임대 토큰 해시 자료 생성
        const request = {
            jobId: job,
            workerId: "review-worker",
            jobRevision: 1,
            leaseTokenHash: hash,
            stage: "SEGMENTING" as const,
            progressPercent: 10,
            now,
            leaseUntil: lease,
            message: "worker-heartbeat"
        };
        // 저장소 진행률 결과의 종류 지정 문자열 및 단계 근거 및 진행률 백분율 70 자료의 필드 일치 확인
        expect(await store.progress(request)).toMatchObject({
            kind: "UPDATED",
            stage: "BUILDING_EVIDENCE",
            progressPercent: 70
        });
        // 만료되거나 교체된 작업 임대 내용을 포함한 기대 결과 일치 확인
        expect(await store.progress({ ...request, workerId: "other" })).toEqual({
            kind: "STALE_LEASE"
        });
    });

    it.each(["VALIDATE_VIDEO", "ANALYZE_VIDEO"] as const)("마지막 시도 만료 %s", async (kind) => {
        // 시험자료 결과를 대상에 저장
        const target = await fixture(kind, "2026-09-04T23:59:00Z", 3);
        // 저장소 작업선점 결과 처리 수행
        await store.claim({ workerId: "new-worker", jobType: kind, now, leaseUntil: lease });
        // 영상 처리 작업 조회
        const [job] =
            await database.sql`select status, failure_code, lease_owner from processing_jobs where id = ${target.job}`;
        // 처리 실패 내용을 포함한 기대 결과 일치 확인
        expect(job).toEqual({
            status: "FAILED",
            failure_code: "WORKER_TIMEOUT",
            lease_owner: null
        });
        // 작업 상태 이력 조회
        const events =
            await database.sql`select event_type from processing_job_events where job_id = ${target.job}`;
        // 처리 실패 내용을 포함한 기대 결과 일치 확인
        expect(events).toEqual([{ event_type: "FAILED" }]);
        // 종류 비교 조건에 따른 처리 경로 분기
        if (kind === "ANALYZE_VIDEO") {
            // 분석 조회
            const [analysis] =
                await database.sql`select status, state_version from analyses where id = ${target.analysis}`;
            // 처리 실패 내용을 포함한 기대 결과 일치 확인
            expect(analysis).toEqual({ status: "FAILED", state_version: 1 });
        } else {
            // 영상 자산 조회
            const [video] =
                await database.sql`select status, validation_error_code from video_assets where id = ${target.video}`;
            // 거부 내용을 포함한 기대 결과 일치 확인
            expect(video).toEqual({ status: "REJECTED", validation_error_code: "WORKER_TIMEOUT" });
        }
        // 다음 조회에서도 실패 로그를 중복 생성하지 않음
        await store.claim({ workerId: "new-worker", jobType: kind, now, leaseUntil: lease });
        // 작업 처리 이력 조회 결과의 행 수가 1개임 확인
        expect(
            await database.sql`select id from processing_job_events where job_id = ${target.job}`
        ).toHaveLength(1);
    });

    it("유효한 마지막 Lease", async () => {
        // 시험자료 결과를 작업에 저장
        const { job } = await fixture("ANALYZE_VIDEO", lease, 3);
        // 저장소 작업선점 결과 처리 수행
        await store.claim({
            workerId: "new-worker",
            jobType: "ANALYZE_VIDEO",
            now,
            leaseUntil: lease
        });
        // 영상 처리 작업 조회
        const [row] = await database.sql`select status from processing_jobs where id = ${job}`;
        // 행 상태의 기대값 지정 문자열 일치 확인
        expect(row?.status).toBe("PROCESSING");
    });
});
