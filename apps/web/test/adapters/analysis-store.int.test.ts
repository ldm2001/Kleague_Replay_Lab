// 분석 저장소 통합 테스트
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AnalysisResult, AnalysisCommand } from "@replay/application";
import { client } from "@replay/database";
import { analysisStore } from "@replay/adapters";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;

type Seed = {
    sessionId: string;
    videoId: string;
    matchId: string;
    ruleId: string;
};

// 생성결과 시점 시험용 2030 01 00 00 준비
const createdAt = "2030-01-01T12:00:00.000Z";
// 만료시각 시점 시험용 2030 01 00 00 준비
const expiresAt = "2030-01-02T12:00:00.000Z";
// 기초자료 생성결과 시점 시험용 2029 01 00 00 준비
const seedCreatedAt = "2029-01-01T12:00:00.000Z";

// 데이터베이스 결과 처리 수행
describeDatabase("PostgreSQL submit-analysis repository", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = databaseUrl ? client(databaseUrl) : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;

    // 저장소 시험용 분석 저장소 결과 준비
    const repository = analysisStore(database);
    // 시험자료 시험용 0개 항목 목록 준비
    const seeds: Seed[] = [];

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await database.sql`select 1`;
    });

    afterEach(async () => {
        // 시험자료 구간치환 결과의 각 사례 순회
        for (const seed of seeds.splice(0)) {
            // 분석 삭제
            await database.sql`delete from analyses where anonymous_session_id = ${seed.sessionId}`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where id = ${seed.videoId}`;
            // 대회 규정 판본 삭제
            await database.sql`delete from competition_rule_versions where id = ${seed.ruleId}`;
            // 경기 삭제
            await database.sql`delete from matches where id = ${seed.matchId}`;
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${seed.sessionId}`;
        }
    });

    afterAll(async () => {
        // 데이터베이스 연결종료 결과 처리 수행
        await database.close();
    });

    // 검증용 사전 시나리오 구성
    const seedScenario = async (
        overrides: {
            sessionExpiresAt?: string;
            sessionRevokedAt?: string | null;
            videoSessionId?: string;
            videoStatus?: string;
            videoExpiresAt?: string | null;
            rightsConfirmedAt?: string | null;
            objectDeletedAt?: string | null;
            withRule?: boolean;
        } = {}
    ): Promise<Seed> => {
        // 시험자료 시험용 무작위식별자 결과 전체 결과 준비
        const suffix = randomUUID().replaceAll("-", "");
        // 기초자료 시험 입력으로 세션 식별자 및 영상 식별자 및 경기 식별자 및 규정 식별자 자료 생성
        const seed: Seed = {
            sessionId: randomUUID(),
            videoId: randomUUID(),
            matchId: randomUUID(),
            ruleId: randomUUID()
        };
        // 시험자료 추가 결과 처리 수행
        seeds.push(seed);

        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at, revoked_at)
      values (
        ${seed.sessionId},
        ${Buffer.from(`submit-analysis-token-${suffix}`)},
        ${seedCreatedAt},
        ${overrides.sessionExpiresAt ?? expiresAt},
        ${overrides.sessionRevokedAt ?? null}
      )
    `;

        // 영상 세션 식별자 시험용 변경항목 영상 세션 식별자 비교 조건 준비
        const videoSessionId = overrides.videoSessionId ?? seed.sessionId;
        // 영상 자산 삽입
        await database.sql`
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

        // 경기 삽입
        await database.sql`
      insert into matches (id, competition, season, match_date)
      values (${seed.matchId}, ${`Submit Analysis Cup ${suffix}`}, '2030', '2030-01-01')
    `;

        // 변경항목 규정 비교 조건에 따른 처리 경로 분기
        if (overrides.withRule !== false) {
            // 대회 규정 판본 삽입
            await database.sql`
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

        // 기초자료 반환
        return seed;
    };

    // 검증용 요청 구성
    const request = (seed: Seed, overrides: Partial<AnalysisCommand> = {}): AnalysisCommand => ({
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
        ...overrides
    });

    // 검증용 수량 구성
    const counts = async (seed: Seed) => {
        // 분석 조회
        const [analysisCount] = await database.sql<{ count: string }[]>`
      select count(*)::text as count from analyses where anonymous_session_id = ${seed.sessionId}
    `;
        // 영상 처리 작업 조회
        const [jobCount] = await database.sql<{ count: string }[]>`
      select count(*)::text as count
      from processing_jobs
      where analysis_id in (select id from analyses where anonymous_session_id = ${seed.sessionId})
    `;
        // 중복 요청 방지 기록 조회
        const [idempotencyCount] = await database.sql<{ count: string }[]>`
      select count(*)::text as count from idempotency_records where anonymous_session_id = ${seed.sessionId}
    `;
        // 분석목록 및 작업목록 및 멱등성 자료 반환
        return {
            analyses: Number(analysisCount?.count ?? 0),
            jobs: Number(jobCount?.count ?? 0),
            idempotency: Number(idempotencyCount?.count ?? 0)
        };
    };

    it("creates a queued analysis, job, and idempotency record with persisted command values", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();

        // 저장소 제출 결과를 결과에 저장
        const result = await repository.submission(request(seed));

        // 결과 종류의 기대값 생성완료 일치 확인
        expect(result.kind).toBe("CREATED");
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "CREATED") return;

        // 분석 조회
        const [analysis] = await database.sql<
            {
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
            }[]
        >`select * from analyses where id = ${result.analysisId}`;
        // 영상 처리 작업 조회
        const [job] = await database.sql<
            {
                job_type: string;
                status: string;
                payload_version: number;
                job_revision: number;
                attempt: number;
                max_attempts: number;
                next_attempt_at: string;
            }[]
        >`select * from processing_jobs where analysis_id = ${result.analysisId}`;
        // 중복 요청 방지 기록 조회
        const [idempotency] = await database.sql<
            {
                operation: string;
                key_hash: Buffer;
                request_hash: Buffer;
                created_at: string;
                expires_at: string;
            }[]
        >`select * from idempotency_records where analysis_id = ${result.analysisId}`;

        // 분석의 식별자 및 상태 대기중 및 지정 항목 지정 문자열 및 규정 버전 식별자 자료의 필드 일치 확인
        expect(analysis).toMatchObject({
            id: result.analysisId,
            status: "QUEUED",
            retention_class: "TEMPORARY",
            applied_rule_version_id: seed.ruleId,
            pipeline_version: "pipeline-test-v1",
            media_policy_version: "media-test-v1",
            state_version: 0
        });
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(analysis!.created_at).toISOString()).toBe(createdAt);
        // 날짜 표준시각문자열 결과의 기대값 만료시각 시점 일치 확인
        expect(new Date(analysis!.expires_at).toISOString()).toBe(expiresAt);
        // 분석 원본의 시험자료 결과 기준 구조 일치 확인
        expect(analysis?.source_fingerprint).toEqual(expect.any(Buffer));
        // 작업의 작업 유형 영상 및 상태 대기중 및 전송자료 버전 7 및 작업 개정번호 0 자료의 필드 일치 확인
        expect(job).toMatchObject({
            job_type: "ANALYZE_VIDEO",
            status: "QUEUED",
            payload_version: 7,
            job_revision: 0,
            attempt: 0,
            max_attempts: 4
        });
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(job!.next_attempt_at).toISOString()).toBe(createdAt);
        // 멱등성의 작업 분석 자료의 필드 일치 확인
        expect(idempotency).toMatchObject({
            operation: "CREATE_ANALYSIS"
        });
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(idempotency!.created_at).toISOString()).toBe(createdAt);
        // 날짜 표준시각문자열 결과의 기대값 만료시각 시점 일치 확인
        expect(new Date(idempotency!.expires_at).toISOString()).toBe(expiresAt);
        // 멱등성 키 해시의 바이트버퍼 변환 결과 기준 구조 일치 확인
        expect(idempotency?.key_hash).toEqual(Buffer.from([1, 2, 3, 4]));
        // 멱등성 요청 해시의 바이트버퍼 변환 결과 기준 구조 일치 확인
        expect(idempotency?.request_hash).toEqual(Buffer.from([5, 6, 7, 8]));
        // 집계 결과의 분석목록 1 및 작업목록 1 및 멱등성 1 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
    });

    it("replays the same request and rejects a different request under the same key", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();
        // 명령 시험용 요청 결과 준비
        const command = request(seed);

        // 저장소 제출 결과를 생성결과에 저장
        const created = await repository.submission(command);
        // 생성결과 종류의 기대값 생성완료 일치 확인
        expect(created.kind).toBe("CREATED");
        // 생성결과 종류 비교 조건에 따른 처리 경로 분기
        if (created.kind !== "CREATED") return;

        // 저장소 제출 결과를 시험자료에 저장
        const replayed = await repository.submission(command);
        // 시험자료의 종류 지정 문자열 및 분석 식별자 자료 기준 구조 일치 확인
        expect(replayed).toEqual({ kind: "REPLAYED", analysisId: created.analysisId });
        // 집계 결과의 분석목록 1 및 작업목록 1 및 멱등성 1 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });

        // 중복 요청 방지 기록 갱신
        await database.sql`
      update idempotency_records
      set expires_at = '2030-01-01T12:00:01.000Z'
      where anonymous_session_id = ${seed.sessionId}
    `;
        // 저장소 제출 결과를 행 재생에 저장
        const expiredRowReplay = await repository.submission(command);
        // 행 재생의 종류 지정 문자열 및 분석 식별자 자료 기준 구조 일치 확인
        expect(expiredRowReplay).toEqual({ kind: "REPLAYED", analysisId: created.analysisId });

        // 저장소 제출 결과를 시험자료에 저장
        const conflict = await repository.submission({
            ...command,
            requestHash: Uint8Array.from([8, 7, 6, 5])
        });
        // 시험자료의 종류 멱등성 키 자료 기준 구조 일치 확인
        expect(conflict).toEqual({ kind: "IDEMPOTENCY_KEY_REUSED" });
        // 집계 결과의 분석목록 1 및 작업목록 1 및 멱등성 1 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
    });

    it("returns VIDEO_ASSET_UNAVAILABLE for invalid session or video ownership state", async () => {
        // 무효 시험용 6개 항목 목록 준비
        const invalidStates: Array<{
            name: string;
            overrides: Parameters<typeof seedScenario>[0];
            extraSession?: boolean;
        }> = [
            {
                name: "expired session",
                overrides: { sessionExpiresAt: "2030-01-01T11:59:59.000Z" }
            },
            {
                name: "revoked session",
                overrides: { sessionRevokedAt: "2030-01-01T11:00:00.000Z" }
            },
            { name: "rejected video", overrides: { videoStatus: "REJECTED" } },
            { name: "expired video", overrides: { videoExpiresAt: "2030-01-01T11:59:59.000Z" } },
            { name: "deleted object", overrides: { objectDeletedAt: "2030-01-01T11:00:00.000Z" } },
            { name: "unconfirmed rights", overrides: { rightsConfirmedAt: null } }
        ];

        // 무효 항목목록 결과의 각 사례 순회
        for (const [index, state] of invalidStates.entries()) {
            // 기초자료 결과를 기초자료에 저장
            const seed = await seedScenario(state.overrides);
            // 저장소 제출 결과를 결과에 저장
            const result = await repository.submission(
                request(seed, {
                    keyHash: Uint8Array.from([10, index + 1]),
                    requestHash: Uint8Array.from([20, index + 1])
                })
            );
            // 영상 자산 사용 불가 내용을 포함한 기대 결과 일치 확인
            expect(result, state.name).toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
            // 집계 결과의 분석목록 0 및 작업목록 0 및 멱등성 0 자료 기준 구조 일치 확인
            expect(await counts(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
        }

        // 기초자료 결과를 시험자료에 저장
        const owner = await seedScenario();
        // 기초자료 결과를 세션에 저장
        const otherSession = await seedScenario();
        // 영상 자산 갱신
        await database.sql`
      update video_assets set anonymous_session_id = ${otherSession.sessionId} where id = ${owner.videoId}
    `;
        // 저장소 제출 결과를 세션 결과에 저장
        const otherSessionResult = await repository.submission(
            request(owner, {
                keyHash: Uint8Array.from([11, 1]),
                requestHash: Uint8Array.from([21, 1])
            })
        );
        // 영상 자산 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(otherSessionResult).toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
    });

    it("re-checks a video after waiting for a concurrent status update", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();
        // 시험자료 보관 변수 생성
        let releaseHolder: (() => void) | undefined;
        // 시험자료 보관 변수 생성
        let signalLocked: (() => void) | undefined;
        // 시험자료 시험용 0 준비
        let holderPid = 0;
        // 갱신 시험용 비동기결과 준비
        const holderMayUpdate = new Promise<void>((resolve) => {
            // 시험자료를 경로해결 값으로 설정
            releaseHolder = resolve;
        });
        // 시험자료 시험용 비동기결과 준비
        const holderLocked = new Promise<void>((resolve) => {
            // 시험자료를 경로해결 값으로 설정
            signalLocked = resolve;
        });

        // 시험자료 시험용 데이터베이스 질의 결과 준비
        const holder = database.sql.begin(async (transaction) => {
            // 입력 조건을 연결에 저장
            const [connection] = await transaction<
                { pid: number }[]
            >`select pg_backend_pid() as pid`;
            // 시험자료를 연결 값으로 설정
            holderPid = connection!.pid;
            // 입력 조건 처리 수행
            await transaction`select id from video_assets where id = ${seed.videoId} for update`;
            // 잠금 획득 완료를 대기 중인 시험에 전달
            signalLocked?.();
            // 갱신 처리 수행
            await holderMayUpdate;
            // 입력 조건 처리 수행
            await transaction`update video_assets set status = 'REJECTED' where id = ${seed.videoId}`;
        });
        // 시험자료 처리 수행
        await holderLocked;

        // 시험자료 시험용 저장소 제출 결과 준비
        const submitting = repository.submission(
            request(seed, {
                keyHash: Uint8Array.from([71, 72]),
                requestHash: Uint8Array.from([81, 82])
            })
        );
        // 실제 잠금 대기를 확인한 뒤 갱신 허용
        try {
            // 시험자료 시험용 날짜 현재시각 결과 비교 조건 준비
            const deadline = Date.now() + 3000;
            // 시험자료 시험용 거짓 준비
            let waiting = false;
            // 반복 조건에 맞는 시험 사례 순회
            while (Date.now() < deadline) {
                // 실행 중인 데이터베이스 연결 조회
                const [row] = await database.sql<{ waiting: boolean }[]>`
          select exists (
            select 1 from pg_stat_activity
            where datname = current_database() and ${holderPid} = any(pg_blocking_pids(pid))
          ) as waiting
        `;
                // 시험자료를 행 값으로 설정
                waiting = row!.waiting;
                // 시험자료에 따른 처리 경로 분기
                if (waiting) break;
                // 비동기결과 처리 수행
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            // 시험자료의 기대값 참 일치 확인
            expect(waiting).toBe(true);
        } finally {
            // 잠금 보유 작업의 대기 해제
            releaseHolder?.();
            // 데이터베이스 질의 반환값 처리 수행
            await holder;
        }

        // 영상 자산 사용 불가 내용을 포함한 기대 결과 일치 확인
        await expect(submitting).resolves.toEqual({ kind: "VIDEO_ASSET_UNAVAILABLE" });
        // 집계 결과의 분석목록 0 및 작업목록 0 및 멱등성 0 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
    });

    it("returns MATCH_UNAVAILABLE when the requested match is absent", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();

        // 저장소 제출 결과를 결과에 저장
        const result = await repository.submission(request(seed, { matchId: randomUUID() }));

        // 경기 자료 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "MATCH_UNAVAILABLE" });
        // 집계 결과의 분석목록 0 및 작업목록 0 및 멱등성 0 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
    });

    it("returns RULE_VERSION_UNAVAILABLE when no rule applies to the match date", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario({ withRule: false });

        // 저장소 제출 결과를 결과에 저장
        const result = await repository.submission(request(seed));

        // 규정 판본 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "RULE_VERSION_UNAVAILABLE" });
        // 집계 결과의 분석목록 0 및 작업목록 0 및 멱등성 0 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
    });

    it("maps only the duplicate video constraint to VIDEO_ASSET_ALREADY_SUBMITTED", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();
        // 저장소 제출 결과를 첫결과에 저장
        const first = await repository.submission(request(seed));
        // 첫결과 종류의 기대값 생성완료 일치 확인
        expect(first.kind).toBe("CREATED");

        // 저장소 제출 결과를 시험자료에 저장
        const duplicate = await repository.submission(
            request(seed, {
                keyHash: Uint8Array.from([31, 32, 33]),
                requestHash: Uint8Array.from([41, 42, 43])
            })
        );

        // 시험자료의 종류 영상 자산 제출값 자료 기준 구조 일치 확인
        expect(duplicate).toEqual({ kind: "VIDEO_ASSET_ALREADY_SUBMITTED" });
        // 집계 결과의 분석목록 1 및 작업목록 1 및 멱등성 1 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
    });

    it("rolls back analysis and idempotency writes when the job insert fails", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();

        // 저장소 제출 결과의 잘못된 입력의 예외 발생 확인
        await expect(repository.submission(request(seed, { maxJobAttempts: 0 }))).rejects.toThrow();

        // 집계 결과의 분석목록 0 및 작업목록 0 및 멱등성 0 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 0, jobs: 0, idempotency: 0 });
    });

    it("converges concurrent submissions for the same key to CREATED and REPLAYED", async () => {
        // 기초자료 결과를 기초자료에 저장
        const seed = await seedScenario();
        // 명령 시험용 요청 결과 준비
        const command = request(seed, {
            keyHash: Uint8Array.from([51, 52, 53]),
            requestHash: Uint8Array.from([61, 62, 63])
        });

        // 비동기결과 전체 결과를 시험자료에 저장
        const results = await Promise.all([
            repository.submission(command),
            repository.submission(command)
        ]);

        // 시험자료 항목변환 결과 정렬 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(results.map((result) => result.kind).sort()).toEqual(["CREATED", "REPLAYED"]);
        // 분석 식별자목록 시험용 시험자료 필터 결과 항목변환 결과 준비
        const analysisIds = results
            .filter(
                (result): result is Extract<AnalysisResult, { kind: "CREATED" | "REPLAYED" }> =>
                    result.kind === "CREATED" || result.kind === "REPLAYED"
            )
            .map((result) => result.analysisId);
        // 집합 크기의 기대값 1 일치 확인
        expect(new Set(analysisIds).size).toBe(1);
        // 집계 결과의 분석목록 1 및 작업목록 1 및 멱등성 1 자료 기준 구조 일치 확인
        expect(await counts(seed)).toEqual({ analyses: 1, jobs: 1, idempotency: 1 });
    });
});
