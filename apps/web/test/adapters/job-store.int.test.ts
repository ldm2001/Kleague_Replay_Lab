// 작업 저장소 통합 테스트
import { createHash as digest, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { jobStore, statusStore } from "@replay/adapters";
import { client } from "@replay/database";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;
// 현재시각 시험용 2030 01 00 00 준비
const NOW = "2030-01-01T12:00:00.000Z";
// 임대 시험용 2030 01 01 00 준비
const LEASE = "2030-01-01T12:01:00.000Z";
// 재시도 가능한 실패의 재선점 가능 시각
const RETRY = "2030-01-01T12:05:00.000Z";

// 데이터베이스 결과 처리 수행
describeDatabase("PostgreSQL job result repository", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = databaseUrl ? client(databaseUrl) : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;
    // 저장소 시험용 작업 저장소 결과 준비
    const repository = jobStore(database);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];

    // 임대가 유효한 분석 작업 시험 자료 생성
    const fixture = async () => {
        const sessionId = randomUUID();
        const assetId = randomUUID();
        const analysisId = randomUUID();
        const jobId = randomUUID();
        const token = digest("sha256").update(jobId).digest();
        sessions.push(sessionId);
        await database.sql`
            insert into anonymous_sessions (id, token_hash, created_at, expires_at)
            values (
                ${sessionId}, ${Buffer.from(randomUUID())},
                '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z'
            )
        `;
        await database.sql`
            insert into video_assets (
                id, anonymous_session_id, object_key, content_sha256, content_type,
                size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at,
                duration_ms, width, height
            ) values (
                ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])},
                'video/mp4', 100, 'VALID', 1, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z',
                4000, 1920, 1080
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
                max_attempts, lease_owner, lease_token_hash, lease_until, stage,
                created_at, updated_at
            ) values (
                ${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3,
                'worker-1', ${token}, ${LEASE}, 'SEGMENTING', ${NOW}, ${NOW}
            )
        `;
        return { sessionId, assetId, analysisId, jobId, token };
    };

    // 시험 자료 작업의 재시도 가능한 작업자 실패 결과 명령 생성
    const transient = (
        job: Awaited<ReturnType<typeof fixture>>,
        retryAt?: string
    ): Parameters<typeof repository.result>[0] => ({
        jobId: job.jobId,
        workerId: "worker-1",
        jobRevision: 1,
        leaseTokenHash: Uint8Array.from(job.token),
        now: NOW,
        payload: { kind: "FAILED", failureCode: "WORKER_TRANSIENT_ERROR", retryable: true },
        ...(retryAt === undefined ? {} : { retryAt })
    });

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await database.sql`select 1`;
    });

    afterEach(async () => {
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const sessionId of sessions.splice(0)) {
            // 분석 삭제
            await database.sql`delete from analyses where anonymous_session_id = ${sessionId}`;
            // 영상 처리 작업 삭제
            await database.sql`delete from processing_jobs where video_asset_id in (select id from video_assets where anonymous_session_id = ${sessionId})`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where anonymous_session_id = ${sessionId}`;
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
        }
    });

    afterAll(async () => {
        // 데이터베이스 연결종료 결과 처리 수행
        await database.close();
    });

    it("accepts one current validation result and rejects its replay", async () => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 자산 식별자 시험용 무작위식별자 결과 준비
        const assetId = randomUUID();
        // 작업 식별자 시험용 무작위식별자 결과 준비
        const jobId = randomUUID();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
        // 영상 자산 삽입
        await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1, 2, 3])}, 'video/mp4',
        100, 'VALIDATING', 0, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
        // 영상 처리 작업 삽입
        await database.sql`
      insert into processing_jobs (
        id, video_asset_id, job_type, status, payload_version, max_attempts, created_at, updated_at
      ) values (${jobId}, ${assetId}, 'VALIDATE_VIDEO', 'QUEUED', 1, 3, ${NOW}, ${NOW})
    `;

        // 임대 토큰 해시 시험용 바이트배열 변환 결과 준비
        const leaseTokenHash = Uint8Array.from(digest("sha256").update("validate-lease").digest());
        // 저장소 작업선점 결과를 작업선점에 저장
        const claim = await repository.claim({
            workerId: "worker-1",
            jobType: "VALIDATE_VIDEO",
            now: NOW,
            leaseUntil: LEASE,
            leaseTokenHash
        });
        // 작업선점 작업 식별자의 기대값 작업 식별자 일치 확인
        expect(claim?.jobId).toBe(jobId);
        // 저장소 진행률 결과의 종류 지정 문자열 및 진행률 백분율 10 자료의 필드 일치 확인
        await expect(
            repository.progress({
                jobId,
                workerId: "worker-1",
                jobRevision: claim!.jobRevision,
                leaseTokenHash,
                stage: "VALIDATING",
                progressPercent: 10,
                now: "2030-01-01T12:00:05.000Z",
                leaseUntil: "2030-01-01T12:01:05.000Z",
                message: "worker-started"
            })
        ).resolves.toMatchObject({ kind: "UPDATED", progressPercent: 10 });
        // 명령 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 1 및 작업 개정번호 및 임대 토큰 해시 자료 생성
        const command = {
            jobId,
            workerId: "worker-1",
            jobRevision: claim!.jobRevision,
            leaseTokenHash,
            now: "2030-01-01T12:00:10.000Z",
            payload: { kind: "VALIDATED" as const, durationMs: 90_000, width: 1920, height: 1080 }
        };

        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(repository.result(command)).resolves.toEqual({ kind: "ACCEPTED" });
        // 저장소 결과의 종류 지정 문자열 자료 기준 구조 일치 확인
        await expect(repository.result(command)).resolves.toEqual({ kind: "ALREADY_FINISHED" });

        // 영상 자산 조회
        const [asset] = await database.sql<
            { status: string; duration_ms: number; width: number; height: number }[]
        >`
      select status, duration_ms, width, height from video_assets where id = ${assetId}
    `;
        // 영상 처리 작업 조회
        const [job] = await database.sql<
            { status: string; stage: string; progress_percent: number }[]
        >`
      select status, stage, progress_percent from processing_jobs where id = ${jobId}
    `;
        // 작업 상태 이력 조회
        const events = await database.sql<{ event_type: string }[]>`
      select event_type from processing_job_events where job_id = ${jobId} order by created_at
    `;
        // 분석 조회
        const [analysis] = await database.sql<{ id: string; status: string }[]>`
      select id, status from analyses where video_asset_id = ${assetId}
    `;
        // 영상 처리 작업 조회
        const [analysisJob] = await database.sql<{ job_type: string; status: string }[]>`
      select job_type, status from processing_jobs where analysis_id = ${analysis?.id ?? null}
    `;
        // 자산의 상태 유효 및 길이 시각 90_000 및 너비 1920 및 높이 1080 자료 기준 구조 일치 확인
        expect(asset).toEqual({ status: "VALID", duration_ms: 90_000, width: 1920, height: 1080 });
        // 작업의 상태 성공 및 단계 성공 및 진행률 백분율 100 자료 기준 구조 일치 확인
        expect(job).toEqual({ status: "SUCCEEDED", stage: "SUCCEEDED", progress_percent: 100 });
        // 시험자료 항목변환 결과의 3개 항목 목록 기준 구조 일치 확인
        expect(events.map((event) => event.event_type)).toEqual([
            "CLAIMED",
            "PROGRESS",
            "SUCCEEDED"
        ]);
        // 분석 상태의 기대값 대기중 일치 확인
        expect(analysis?.status).toBe("QUEUED");
        // 분석 작업의 작업 유형 영상 및 상태 대기중 자료 기준 구조 일치 확인
        expect(analysisJob).toEqual({ job_type: "ANALYZE_VIDEO", status: "QUEUED" });

        // 영상 처리 작업 조회
        const [analysisTarget] = await database.sql<{ id: string }[]>`
      select id from processing_jobs where analysis_id = ${analysis!.id} and job_type = 'ANALYZE_VIDEO'
    `;
        // 분석 임대 시험용 바이트배열 변환 결과 준비
        const analysisLease = Uint8Array.from(digest("sha256").update("analysis-lease").digest());
        // 영상 처리 작업 갱신
        await database.sql`
      update processing_jobs
      set status = 'PROCESSING', stage = 'SEGMENTING', job_revision = 1, attempt = 1,
          lease_owner = 'worker-1', lease_token_hash = ${Buffer.from(analysisLease)},
          lease_until = '2030-01-01T12:01:20.000Z'
      where id = ${analysisTarget!.id}
    `;
        // 관측이나 처리 실패의 저장 접수 성공이며 파울 판정 승인과 별개임 확인
        await expect(
            repository.result({
                jobId: analysisTarget!.id,
                workerId: "worker-1",
                jobRevision: 1,
                leaseTokenHash: analysisLease,
                now: "2030-01-01T12:00:30.000Z",
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: ["incident_category_classification_pending"],
                    shots: [
                        {
                            index: 0,
                            startMs: 0,
                            endMs: 4000,
                            playbackSpeed: "UNKNOWN",
                            isReplay: false,
                            cameraAngle: null
                        }
                    ],
                    candidates: [
                        {
                            index: 1,
                            category: "OTHER",
                            startMs: 500,
                            endMs: 1500,
                            anchorMs: 1000,
                            confidence: 0.42,
                            cameraSufficiency: "MEDIUM",
                            reasons: ["motion-spike"],
                            shotIndices: [0]
                        }
                    ],
                    evidence: [
                        {
                            candidateIndex: 1,
                            kind: "FRAME" as const,
                            objectKey: `evidence/${analysis!.id}/${analysisTarget!.id}/candidate-0001.jpg`,
                            contentSha256: "01".repeat(32),
                            startMs: 1000,
                            endMs: 1000,
                            width: 1920,
                            height: 1080
                        }
                    ]
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 분석 조회
        const [completed] = await database.sql<
            { status: string; pipeline_version: string; completed_at: string }[]
        >`
      select status, pipeline_version, completed_at from analyses where id = ${analysis!.id}
    `;
        // 영상 샷 조회
        const storedShots = await database.sql<{ shot_index: number }[]>`
      select shot_index from shots where analysis_id = ${analysis!.id}
    `;
        // 인식 후보 사건 조회
        const storedCandidates = await database.sql<
            {
                candidate_index: number;
                detection_confidence: number;
                start_ms: number;
                end_ms: number;
            }[]
        >`
      select candidate_index, detection_confidence, start_ms, end_ms from incident_candidates where analysis_id = ${analysis!.id}
    `;
        // 근거 자산 조회
        const storedEvidence = await database.sql<
            { kind: string; object_key: string; start_ms: number; end_ms: number }[]
        >`
      select kind, object_key, start_ms, end_ms from evidence_assets where analysis_id = ${analysis!.id}
    `;
        // 완료 상태의 기대값 완료 일치 확인
        expect(completed?.status).toBe("COMPLETED");
        // 완료 파이프라인 버전의 기대값 영상 기준자료 일치 확인
        expect(completed?.pipeline_version).toBe("video-baseline-v1");
        // 완료 완료 시점의 값 존재 확인
        expect(completed?.completed_at).not.toBeNull();
        // 저장값 샷목록의 1개 항목 목록 기준 구조 일치 확인
        expect(storedShots).toEqual([{ shot_index: 0 }]);
        // 저장값 후보목록의 1개 항목 목록 기준 구조 일치 확인
        expect(storedCandidates).toEqual([
            { candidate_index: 1, detection_confidence: 0.42, start_ms: 500, end_ms: 1500 }
        ]);
        // 저장값 근거의 1개 항목 목록 기준 구조 일치 확인
        expect(storedEvidence).toEqual([
            {
                kind: "FRAME",
                object_key: `evidence/${analysis!.id}/${analysisTarget!.id}/candidate-0001.jpg`,
                start_ms: 1000,
                end_ms: 1000
            }
        ]);
        const result = await statusStore(database).analysis({
            anonymousSessionId: sessionId,
            analysisId: analysis!.id,
            now: "2030-01-01T12:00:40.000Z"
        });

        expect(result?.analysis?.evidence).toEqual([
            {
                evidenceId: expect.any(String),
                candidateIndex: 1,
                kind: "FRAME",
                startMs: 1000,
                endMs: 1000,
                objectKey: `evidence/${analysis!.id}/${analysisTarget!.id}/candidate-0001.jpg`,
                contentSha256: "01".repeat(32)
            }
        ]);
    });

    // 구간형 FRAME 신규 제출 거부와 전체 저장 상태 보존 확인
    it("rejects a new FRAME interval without partial writes", async () => {
        const { analysisId, jobId, token } = await fixture();

        await expect(
            repository.result({
                jobId,
                workerId: "worker-1",
                jobRevision: 1,
                leaseTokenHash: token,
                now: "2030-01-01T12:00:10.000Z",
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: ["incident_category_classification_pending"],
                    shots: [
                        {
                            index: 0,
                            startMs: 0,
                            endMs: 4000,
                            playbackSpeed: "UNKNOWN",
                            isReplay: false,
                            cameraAngle: null
                        }
                    ],
                    candidates: [
                        {
                            index: 1,
                            category: "OTHER",
                            startMs: 500,
                            endMs: 1500,
                            anchorMs: 1000,
                            confidence: 0.42,
                            cameraSufficiency: "MEDIUM",
                            reasons: ["motion-spike"],
                            shotIndices: [0]
                        }
                    ],
                    evidence: [
                        {
                            candidateIndex: 1,
                            kind: "FRAME",
                            objectKey: `evidence/${analysisId}/${jobId}/candidate-0001.jpg`,
                            contentSha256: "01".repeat(32),
                            startMs: 500,
                            endMs: 1500,
                            width: 1920,
                            height: 1080
                        }
                    ]
                }
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });

        const [analysis] = await database.sql<
            { status: string; pipeline_version: string | null; completed_at: string | null }[]
        >`
            select status, pipeline_version, completed_at
            from analyses where id = ${analysisId}
        `;
        const [job] = await database.sql<
            { status: string; stage: string; job_revision: number; lease_owner: string }[]
        >`
            select status, stage, job_revision, lease_owner
            from processing_jobs where id = ${jobId}
        `;
        const [counts] = await database.sql<
            { shots: number; candidates: number; evidence: number; events: number }[]
        >`
            select
                (select count(*)::int from shots where analysis_id = ${analysisId}) as shots,
                (select count(*)::int from incident_candidates where analysis_id = ${analysisId}) as candidates,
                (select count(*)::int from evidence_assets where analysis_id = ${analysisId}) as evidence,
                (select count(*)::int from processing_job_events where job_id = ${jobId}) as events
        `;

        expect(analysis).toEqual({ status: "QUEUED", pipeline_version: null, completed_at: null });
        expect(job).toEqual({
            status: "PROCESSING",
            stage: "SEGMENTING",
            job_revision: 1,
            lease_owner: "worker-1"
        });
        expect(counts).toEqual({ shots: 0, candidates: 0, evidence: 0, events: 0 });
    });

    // 과거 구간형 FRAME 자료의 기존 조회 계약 보존 확인
    it("reads a historical FRAME interval without changing its timestamps", async () => {
        const { sessionId, analysisId } = await fixture();
        const candidateId = randomUUID();
        const evidenceId = randomUUID();
        const objectKey = `evidence/${analysisId}/legacy-frame.jpg`;
        await database.sql`
            update analyses set status = 'CANDIDATES_READY' where id = ${analysisId}
        `;
        await database.sql`
            insert into incident_candidates (
                id, analysis_id, candidate_index, review_scenario,
                start_ms, end_ms, camera_sufficiency, review_status
            ) values (
                ${candidateId}, ${analysisId}, 1, 'OTHER',
                500, 1500, 'MEDIUM', 'UNREVIEWED'
            )
        `;
        await database.sql`
            insert into evidence_assets (
                id, analysis_id, incident_candidate_id, kind, object_key,
                content_sha256, start_ms, end_ms, created_at, expires_at
            ) values (
                ${evidenceId}, ${analysisId}, ${candidateId}, 'FRAME', ${objectKey},
                ${Buffer.from("01".repeat(32), "hex")}, 500, 1500,
                ${NOW}, '2030-01-02T12:00:00.000Z'
            )
        `;

        const result = await statusStore(database).analysis({
            anonymousSessionId: sessionId,
            analysisId,
            now: NOW
        });

        expect(result?.analysis?.evidence).toEqual([
            {
                evidenceId,
                candidateIndex: 1,
                kind: "FRAME",
                startMs: 500,
                endMs: 1500,
                objectKey,
                contentSha256: "01".repeat(32)
            }
        ]);
    });

    it("reclaims an expired processing lease", async () => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 자산 식별자 시험용 무작위식별자 결과 준비
        const assetId = randomUUID();
        // 작업 식별자 시험용 무작위식별자 결과 준비
        const jobId = randomUUID();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
        // 영상 자산 삽입
        await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])}, 'video/mp4',
        100, 'VALIDATING', 0, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
        // 영상 처리 작업 삽입
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

        // 새 작업자 임대 토큰 해시 준비
        const successor = digest("sha256").update("delete-lease").digest();
        // 저장소 작업선점 결과를 시험자료에 저장
        const claimed = await repository.claim({
            workerId: "new-worker",
            jobType: "DELETE_VIDEO_ASSET",
            now: NOW,
            leaseUntil: LEASE,
            leaseTokenHash: successor
        });

        // 시험자료의 작업 식별자 및 작업 개정번호 2 및 시도 2 자료의 필드 일치 확인
        expect(claimed).toMatchObject({ jobId, jobRevision: 2, attempt: 2 });
        // 영상 처리 작업의 임대 소유자와 해시 조회
        const [row] = await database.sql<{ lease_owner: string; lease_token_hash: Buffer }[]>`
      select lease_owner, lease_token_hash from processing_jobs where id = ${jobId}
    `;
        // 만료 임대의 해시가 새 작업자가 넘긴 해시로 교체됨 확인
        expect(row).toEqual({ lease_owner: "new-worker", lease_token_hash: successor });
    });

    it("marks an analysis failed for an accepted worker failure", async () => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 자산 식별자 시험용 무작위식별자 결과 준비
        const assetId = randomUUID();
        // 분석 식별자 시험용 무작위식별자 결과 준비
        const analysisId = randomUUID();
        // 작업 식별자 시험용 무작위식별자 결과 준비
        const jobId = randomUUID();
        // 토큰 시험용 바이트배열 변환 결과 준비
        const token = Uint8Array.from(digest("sha256").update("analysis-failure").digest());
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z')
    `;
        // 영상 자산 삽입
        await database.sql`
      insert into video_assets (
        id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
      ) values (
        ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])}, 'video/mp4',
        100, 'VALID', 1, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
      )
    `;
        // 분석 삽입
        await database.sql`
      insert into analyses (
        id, anonymous_session_id, video_asset_id, status, retention_class,
        state_version, created_at, expires_at
      ) values (
        ${analysisId}, ${sessionId}, ${assetId}, 'QUEUED', 'TEMPORARY', 0,
        ${NOW}, '2030-01-02T12:00:00.000Z'
      )
    `;
        // 영상 처리 작업 삽입
        await database.sql`
      insert into processing_jobs (
        id, analysis_id, job_type, status, payload_version, job_revision, attempt,
        max_attempts, lease_owner, lease_token_hash, lease_until, stage, created_at, updated_at
      ) values (
        ${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3,
        'worker-1', ${Buffer.from(token)}, ${LEASE}, 'SEGMENTING', ${NOW}, ${NOW}
      )
    `;

        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            repository.result({
                jobId,
                workerId: "worker-1",
                jobRevision: 1,
                leaseTokenHash: token,
                now: "2030-01-01T12:00:10.000Z",
                payload: { kind: "FAILED", failureCode: "PIPELINE_ERROR", retryable: false }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 분석 조회
        const [analysis] = await database.sql<{ status: string; failure_code: string }[]>`
      select status, failure_code from analyses where id = ${analysisId}
    `;
        // 처리 실패 내용을 포함한 기대 결과 일치 확인
        expect(analysis).toEqual({ status: "FAILED", failure_code: "PIPELINE_ERROR" });
    });

    it("requeues a retryable worker failure until its retry time", async () => {
        // 시도가 남고 원본이 살아 있는 분석 작업 준비
        const job = await fixture();

        // 재시도 가능한 실패 결과 접수 확인
        await expect(repository.result(transient(job, RETRY))).resolves.toEqual({ kind: "ACCEPTED" });

        // 재대기한 작업 상태 조회
        const [row] = await database.sql`
            select status, stage, progress_percent, attempt, job_revision, lease_owner,
                   lease_token_hash, lease_until, failure_code, retryable,
                   next_attempt_at = ${RETRY}::timestamptz as scheduled
            from processing_jobs where id = ${job.jobId}
        `;
        // 임대를 풀고 같은 시도 번호로 재선점 시각까지 대기함 확인
        expect(row).toEqual({
            status: "QUEUED",
            stage: "QUEUED",
            progress_percent: 0,
            attempt: 1,
            job_revision: 1,
            lease_owner: null,
            lease_token_hash: null,
            lease_until: null,
            failure_code: null,
            retryable: null,
            scheduled: true
        });
        // 재대기 중인 분석 상태 조회
        const [analysis] = await database.sql`
            select status, failure_code, state_version from analyses where id = ${job.analysisId}
        `;
        // 재대기가 분석을 실패로 닫지 않음 확인
        expect(analysis).toEqual({ status: "QUEUED", failure_code: null, state_version: 0 });
        // 작업 이력 조회
        const events = await database.sql`
            select event_type, stage, progress_percent, message, attempt, job_revision
            from processing_job_events where job_id = ${job.jobId} order by created_at
        `;
        // 최종 실패와 구분되는 재대기 이력 한 건 기록 확인
        expect(events).toEqual([
            {
                event_type: "REQUEUED",
                stage: "QUEUED",
                progress_percent: 0,
                message: "WORKER_TRANSIENT_ERROR",
                attempt: 1,
                job_revision: 1
            }
        ]);

        // 응답 유실 뒤 같은 실패 결과 재전송의 멱등 응답 확인
        await expect(repository.result(transient(job, RETRY))).resolves.toEqual({
            kind: "ALREADY_FINISHED"
        });
        // 다음 작업자의 임대 토큰 해시 준비
        const successor = Uint8Array.from(digest("sha256").update("requeue-claim").digest());
        // 재선점 시각 직전 선점 시도
        const early = await repository.claim({
            workerId: "worker-2",
            jobType: "ANALYZE_VIDEO",
            now: "2030-01-01T12:04:59.000Z",
            leaseUntil: "2030-01-01T12:06:00.000Z",
            leaseTokenHash: successor
        });
        // 재선점 시각 전에는 다시 배정하지 않음 확인
        expect(early).toBeNull();
        // 재선점 시각의 선점 시도
        const claimed = await repository.claim({
            workerId: "worker-2",
            jobType: "ANALYZE_VIDEO",
            now: RETRY,
            leaseUntil: "2030-01-01T12:06:00.000Z",
            leaseTokenHash: successor
        });
        // 다음 시도와 새 작업 판본으로 재배정 확인
        expect(claimed).toMatchObject({ jobId: job.jobId, jobRevision: 2, attempt: 2 });
    });

    it.each<[string, (job: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>, string | undefined]>([
        [
            "on its last attempt",
            (job) => database.sql`update processing_jobs set attempt = max_attempts where id = ${job.jobId}`,
            RETRY
        ],
        ["without a retry time", async () => undefined, undefined],
        [
            "after its source session expired",
            (job) => database.sql`
                update anonymous_sessions set expires_at = '2029-06-01T00:00:00.000Z'
                where id = ${job.sessionId}
            `,
            RETRY
        ]
    ])("closes a retryable worker failure %s", async (_name, setup, retryAt) => {
        // 재대기 조건 하나가 빠진 분석 작업 준비
        const job = await fixture();
        // 시험 사례별 조건 적용
        await setup(job);

        // 재시도 가능한 실패 결과 접수 확인
        await expect(repository.result(transient(job, retryAt))).resolves.toEqual({ kind: "ACCEPTED" });

        // 닫힌 작업 상태 조회
        const [row] = await database.sql`
            select status, stage, failure_code, retryable, lease_owner,
                   next_attempt_at is null as unscheduled
            from processing_jobs where id = ${job.jobId}
        `;
        // 재선점 예약 없이 작업자가 보낸 실패 분류로 최종 실패 확인
        expect(row).toEqual({
            status: "FAILED",
            stage: "FAILED",
            failure_code: "WORKER_TRANSIENT_ERROR",
            retryable: true,
            lease_owner: null,
            unscheduled: true
        });
        // 분석 상태 조회
        const [analysis] = await database.sql`
            select status, failure_code from analyses where id = ${job.analysisId}
        `;
        // 분석도 같은 실패 부호로 닫힘 확인
        expect(analysis).toEqual({ status: "FAILED", failure_code: "WORKER_TRANSIENT_ERROR" });
        // 작업 이력 조회
        const events = await database.sql`
            select event_type from processing_job_events where job_id = ${job.jobId}
        `;
        // 재대기 이력 없이 최종 실패 이력만 기록 확인
        expect(events).toEqual([{ event_type: "FAILED" }]);
    });

    it("keeps a video validating while its validation job waits for a retry", async () => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 자산 식별자 시험용 무작위식별자 결과 준비
        const assetId = randomUUID();
        // 작업 식별자 시험용 무작위식별자 결과 준비
        const jobId = randomUUID();
        // 현재 임대 토큰 해시 준비
        const token = digest("sha256").update(jobId).digest();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`
            insert into anonymous_sessions (id, token_hash, created_at, expires_at)
            values (
                ${sessionId}, ${Buffer.from(randomUUID())},
                '2029-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z'
            )
        `;
        // 검증 중인 영상 자산 삽입
        await database.sql`
            insert into video_assets (
                id, anonymous_session_id, object_key, content_sha256, content_type,
                size_bytes, status, state_version, rights_confirmed_at, created_at, expires_at
            ) values (
                ${assetId}, ${sessionId}, ${`tests/${assetId}.mp4`}, ${Buffer.from([1])},
                'video/mp4', 100, 'VALIDATING', 0, ${NOW}, ${NOW}, '2031-01-01T00:00:00.000Z'
            )
        `;
        // 임대가 유효한 검증 작업 삽입
        await database.sql`
            insert into processing_jobs (
                id, video_asset_id, job_type, status, payload_version, job_revision, attempt,
                max_attempts, lease_owner, lease_token_hash, lease_until, stage,
                created_at, updated_at
            ) values (
                ${jobId}, ${assetId}, 'VALIDATE_VIDEO', 'PROCESSING', 1, 1, 1, 3,
                'worker-1', ${token}, ${LEASE}, 'VALIDATING', ${NOW}, ${NOW}
            )
        `;

        // 재시도 가능한 검증 실패 결과 접수 확인
        await expect(
            repository.result({
                jobId,
                workerId: "worker-1",
                jobRevision: 1,
                leaseTokenHash: Uint8Array.from(token),
                now: NOW,
                payload: { kind: "FAILED", failureCode: "WORKER_TRANSIENT_ERROR", retryable: true },
                retryAt: RETRY
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 영상 자산 상태 조회
        const [video] = await database.sql`
            select status, state_version, validation_error_code from video_assets where id = ${assetId}
        `;
        // 재대기가 영상을 거부로 닫지 않음 확인
        expect(video).toEqual({ status: "VALIDATING", state_version: 0, validation_error_code: null });
        // 검증 작업 상태 조회
        const [row] = await database.sql`select status from processing_jobs where id = ${jobId}`;
        // 검증 작업의 재대기 확인
        expect(row).toEqual({ status: "QUEUED" });
    });
});
