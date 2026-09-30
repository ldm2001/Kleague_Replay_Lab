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
    // 새 작업자 임대에 저장할 기존 임대와 다른 토큰 해시 준비
    const successor = createHash("sha256").update("new-worker-lease").digest();

    // 새 작업자가 고정 시각에 다른 임대 해시로 작업 선점
    const claim = (jobType: "VALIDATE_VIDEO" | "ANALYZE_VIDEO") => store.claim({
        workerId: "new-worker",
        jobType,
        now,
        leaseUntil: lease,
        leaseTokenHash: successor
    });

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

    // 검증용 입력 모형 구성하며 임대 기한이 없으면 임대 없는 대기 작업으로 구성
    const fixture = async (
        kind: "VALIDATE_VIDEO" | "ANALYZE_VIDEO",
        until: string | null,
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
        // 임대 기한 유무로 처리 중 작업과 대기 작업 구분
        const leased = until !== null;
        // 영상 처리 작업 삽입
        await database.sql`
            insert into processing_jobs (
                id, video_asset_id, analysis_id, job_type, status, payload_version,
                job_revision, attempt, max_attempts, lease_owner, lease_token_hash,
                lease_until, stage, progress_percent, created_at, updated_at
            ) values (
                ${job!}, ${kind === "VALIDATE_VIDEO" ? video! : null},
                ${kind === "ANALYZE_VIDEO" ? analysis! : null}, ${kind},
                ${leased ? "PROCESSING" : "QUEUED"}, 1, 1, ${attempt}, 3,
                ${leased ? "review-worker" : null}, ${leased ? hash : null}, ${until},
                ${leased ? "BUILDING_EVIDENCE" : "QUEUED"}, ${leased ? 70 : 0}, ${now}, ${now}
            )
        `;
        // 세션 및 영상 및 분석 및 작업 자료 반환
        return { session: session!, video: video!, analysis: analysis!, job: job! };
    };
    // 보존 이탈 조건의 생성 시각
    const earlier = "2026-09-04T00:00:00.000Z";
    // 현재 시각보다 앞선 보존 기한
    const lapsed = "2026-09-04T12:00:00.000Z";
    // 시험자료로 만든 작업 대상 식별자 묶음
    type Target = Awaited<ReturnType<typeof fixture>>;
    // 작업 대상이나 소유 세션을 보존 규칙 밖으로 보내는 조건별 갱신 정의
    const lapses = {
        // 원본 영상 보존 기한 경과
        "원본 만료": (target: Target) => database.sql`
            update video_assets set created_at = ${earlier}, expires_at = ${lapsed}
            where id = ${target.video}
        `,
        // 원본 영상 객체 삭제
        "원본 삭제": (target: Target) => database.sql`
            update video_assets set object_deleted_at = ${now} where id = ${target.video}
        `,
        // 소유 세션 폐기
        "세션 폐기": (target: Target) => database.sql`
            update anonymous_sessions set revoked_at = ${now} where id = ${target.session}
        `,
        // 소유 세션 기한 경과
        "세션 만료": (target: Target) => database.sql`
            update anonymous_sessions set created_at = ${earlier}, expires_at = ${lapsed}
            where id = ${target.session}
        `,
        // 분석 보존 기한 경과
        "분석 만료": (target: Target) => database.sql`
            update analyses set created_at = ${earlier}, expires_at = ${lapsed}
            where id = ${target.analysis}
        `
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
        await claim(kind);
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
        await claim(kind);
        // 작업 처리 이력 조회 결과의 행 수가 1개임 확인
        expect(
            await database.sql`select id from processing_job_events where job_id = ${target.job}`
        ).toHaveLength(1);
    });

    it("유효한 마지막 Lease", async () => {
        // 시험자료 결과를 작업에 저장
        const { job } = await fixture("ANALYZE_VIDEO", lease, 3);
        // 저장소 작업선점 결과 처리 수행
        await claim("ANALYZE_VIDEO");
        // 영상 처리 작업 조회
        const [row] = await database.sql`select status from processing_jobs where id = ${job}`;
        // 행 상태의 기대값 지정 문자열 일치 확인
        expect(row?.status).toBe("PROCESSING");
    });

    it.each([
        { kind: "VALIDATE_VIDEO", lapse: "원본 만료" },
        { kind: "VALIDATE_VIDEO", lapse: "원본 삭제" },
        { kind: "VALIDATE_VIDEO", lapse: "세션 폐기" },
        { kind: "VALIDATE_VIDEO", lapse: "세션 만료" },
        { kind: "ANALYZE_VIDEO", lapse: "분석 만료" },
        { kind: "ANALYZE_VIDEO", lapse: "원본 만료" },
        { kind: "ANALYZE_VIDEO", lapse: "원본 삭제" },
        { kind: "ANALYZE_VIDEO", lapse: "세션 폐기" },
        { kind: "ANALYZE_VIDEO", lapse: "세션 만료" }
    ] as const)("보존 이탈 대기 작업 종료 $kind $lapse", async ({ kind, lapse }) => {
        // 임대 없는 대기 작업 준비
        const target = await fixture(kind, null, 0);
        // 작업 대상이나 소유 세션을 보존 규칙 밖으로 보냄
        await lapses[lapse](target);
        // 저장소 작업선점 결과 처리 수행
        await claim(kind);
        // 영상 처리 작업 조회
        const [job] = await database.sql`
            select status, failure_code, retryable, lease_owner
            from processing_jobs where id = ${target.job}
        `;
        // 재시도 없는 원본 소멸 실패로 종료됨 확인
        expect(job).toEqual({
            status: "FAILED",
            failure_code: "SOURCE_UNAVAILABLE",
            retryable: false,
            lease_owner: null
        });
        // 종류 비교 조건에 따른 처리 경로 분기
        if (kind === "ANALYZE_VIDEO") {
            // 분석 조회
            const [analysis] = await database.sql`
                select status, failure_code from analyses where id = ${target.analysis}
            `;
            // 분석이 같은 사유로 실패함 확인
            expect(analysis).toEqual({ status: "FAILED", failure_code: "SOURCE_UNAVAILABLE" });
        } else {
            // 영상 자산 조회
            const [video] = await database.sql`
                select status, validation_error_code from video_assets where id = ${target.video}
            `;
            // 검증 영상이 같은 사유로 거부됨 확인
            expect(video).toEqual({
                status: "REJECTED",
                validation_error_code: "SOURCE_UNAVAILABLE"
            });
        }
        // 작업 상태 이력 조회
        const events = await database.sql`
            select event_type, message from processing_job_events where job_id = ${target.job}
        `;
        // 같은 사유의 실패 이력 한 건 확인
        expect(events).toEqual([{ event_type: "FAILED", message: "SOURCE_UNAVAILABLE" }]);
        // 다시 선점해도 종료 이력을 중복 기록하지 않음
        await claim(kind);
        // 작업 처리 이력 조회 결과의 행 수가 1개임 확인
        expect(
            await database.sql`select id from processing_job_events where job_id = ${target.job}`
        ).toHaveLength(1);
    });

    it("먼저 생성된 보존 이탈 작업 대신 생존 작업 선점", async () => {
        // 선점 순서가 앞서도록 먼저 생성된 대기 작업 준비
        const dead = await fixture("ANALYZE_VIDEO", null, 0);
        // 대기 작업의 생성 시각을 앞당겨 선점 순서의 맨 앞에 둠
        await database.sql`
            update processing_jobs set created_at = ${earlier} where id = ${dead.job}
        `;
        // 먼저 생성된 작업의 분석 보존 기한 경과
        await lapses["분석 만료"](dead);
        // 보존 규칙 안의 대기 작업 준비
        const live = await fixture("ANALYZE_VIDEO", null, 0);
        // 저장소 작업선점 결과를 선점결과에 저장
        const claimed = await claim("ANALYZE_VIDEO");
        // 생존 작업만 선점됨 확인
        expect(claimed).toMatchObject({
            jobId: live.job,
            analysisId: live.analysis,
            attempt: 1
        });
        // 보존 이탈 작업 조회
        const [job] = await database.sql`
            select status, failure_code from processing_jobs where id = ${dead.job}
        `;
        // 보존 이탈 작업은 임대 없이 종료됨 확인
        expect(job).toEqual({ status: "FAILED", failure_code: "SOURCE_UNAVAILABLE" });
    });

    it.each(["VALIDATE_VIDEO", "ANALYZE_VIDEO"] as const)(
        "임대 중인 보존 이탈 작업 유지 %s",
        async (kind) => {
            // 임대가 유효한 처리 중 작업 준비
            const target = await fixture(kind, lease, 1);
            // 원본 영상 객체 삭제
            await lapses["원본 삭제"](target);
            // 저장소 작업선점 결과 처리 수행
            await claim(kind);
            // 영상 처리 작업 조회
            const [job] = await database.sql`
                select status, lease_owner from processing_jobs where id = ${target.job}
            `;
            // 작업자가 결과를 제출할 때까지 기존 임대 유지 확인
            expect(job).toEqual({ status: "PROCESSING", lease_owner: "review-worker" });
            // 작업 처리 이력이 추가되지 않음 확인
            expect(
                await database.sql`
                    select id from processing_job_events where job_id = ${target.job}
                `
            ).toHaveLength(0);
        }
    );

    it.each([
        { attempt: 1, code: "SOURCE_UNAVAILABLE" },
        { attempt: 3, code: "WORKER_TIMEOUT" }
    ] as const)("만료 임대 보존 이탈 작업 시도 $attempt 종료 $code", async ({ attempt, code }) => {
        // 임대가 만료된 처리 중 분석 작업 준비
        const target = await fixture("ANALYZE_VIDEO", "2026-09-04T23:59:00Z", attempt);
        // 소유 세션 폐기
        await lapses["세션 폐기"](target);
        // 저장소 작업선점 결과 처리 수행
        await claim("ANALYZE_VIDEO");
        // 영상 처리 작업 조회
        const [job] = await database.sql`
            select status, failure_code, lease_owner from processing_jobs where id = ${target.job}
        `;
        // 남은 시도가 있으면 원본 소멸 사유로 시도를 소진했으면 시간 초과 사유로 종료됨 확인
        expect(job).toEqual({ status: "FAILED", failure_code: code, lease_owner: null });
        // 작업 상태 이력 조회
        const events = await database.sql`
            select message from processing_job_events where job_id = ${target.job}
        `;
        // 같은 사유의 실패 이력 한 건 확인
        expect(events).toEqual([{ message: code }]);
    });

    it("보존 이탈 원본의 검증 결과 거부 후 실패 보고 접수", async () => {
        // 임대가 유효한 검증 작업 준비
        const target = await fixture("VALIDATE_VIDEO", lease, 1);
        // 원본 영상 보존 기한 경과
        await lapses["원본 만료"](target);
        // 현재 임대의 결과 제출 명령 구성
        const command = {
            jobId: target.job,
            workerId: "review-worker",
            jobRevision: 1,
            leaseTokenHash: hash,
            now
        };
        // 검증 결과가 예외 없이 원본 거부로 끝남 확인
        await expect(
            store.result({
                ...command,
                payload: { kind: "VALIDATED", durationMs: 90_000, width: 1920, height: 1080 }
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 영상 자산 조회
        const [video] = await database.sql`
            select status from video_assets where id = ${target.video}
        `;
        // 검증 영상 상태가 바뀌지 않음 확인
        expect(video).toEqual({ status: "VALIDATING" });
        // 후속 분석이 생성되지 않음 확인
        expect(
            await database.sql`select id from analyses where video_asset_id = ${target.video}`
        ).toHaveLength(0);
        // 거부 이후 작업자의 실패 보고가 생존 조건과 무관하게 접수됨 확인
        await expect(
            store.result({
                ...command,
                payload: {
                    kind: "FAILED",
                    failureCode: "WORKER_RESULT_REJECTED",
                    retryable: false
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 영상 처리 작업 조회
        const [job] = await database.sql`
            select status, failure_code from processing_jobs where id = ${target.job}
        `;
        // 작업이 거부 사유로 종료됨 확인
        expect(job).toEqual({ status: "FAILED", failure_code: "WORKER_RESULT_REJECTED" });
    });

    it("보존 이탈 분석의 기준선 결과 거부", async () => {
        // 임대가 유효한 분석 작업 준비
        const target = await fixture("ANALYZE_VIDEO", lease, 1);
        // 분석 보존 기한 경과
        await lapses["분석 만료"](target);
        // 기준선 결과가 잠금 이후 생존 조건 검사에서 원본 거부로 끝남 확인
        await expect(
            store.result({
                jobId: target.job,
                workerId: "review-worker",
                jobRevision: 1,
                leaseTokenHash: hash,
                now,
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: [],
                    shots: [],
                    candidates: []
                }
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 분석 조회
        const [analysis] = await database.sql`
            select status, state_version, completed_at from analyses where id = ${target.analysis}
        `;
        // 분석 상태가 바뀌지 않음 확인
        expect(analysis).toEqual({ status: "QUEUED", state_version: 0, completed_at: null });
        // 영상 처리 작업 조회
        const [job] = await database.sql`
            select status from processing_jobs where id = ${target.job}
        `;
        // 작업은 실패 보고를 기다리며 처리 중 상태 유지 확인
        expect(job).toEqual({ status: "PROCESSING" });
    });

    it.each(["분석 만료", "원본 만료", "원본 삭제", "세션 폐기", "세션 만료"] as const)(
        "보존 이탈 분석의 사전 검사와 증거 접근 거부 %s",
        async (lapse) => {
            // 임대가 유효한 분석 작업 준비
            const target = await fixture("ANALYZE_VIDEO", lease, 1);
            // 현재 임대의 권한 확인 명령 구성
            const command = {
                jobId: target.job,
                workerId: "review-worker",
                jobRevision: 1,
                leaseTokenHash: hash,
                now
            };
            // 보존 규칙 안에서는 사전 검사가 승인됨 확인
            await expect(store.preflight(command)).resolves.toMatchObject({
                kind: "AUTHORIZED"
            });
            // 보존 규칙 안에서는 증거 접근이 승인됨 확인
            await expect(store.access(command)).resolves.toEqual({
                kind: "AUTHORIZED",
                analysisId: target.analysis
            });
            // 작업 대상이나 소유 세션을 보존 규칙 밖으로 보냄
            await lapses[lapse](target);
            // 무거운 파일 검사 전에 사전 검사가 원본 거부로 끝남 확인
            await expect(store.preflight(command)).resolves.toEqual({
                kind: "INVALID_RESULT",
                reason: "SOURCE"
            });
            // 고아 증거 객체를 막도록 증거 접근이 거부됨 확인
            await expect(store.access(command)).resolves.toEqual({ kind: "SOURCE_UNAVAILABLE" });
        }
    );
});
