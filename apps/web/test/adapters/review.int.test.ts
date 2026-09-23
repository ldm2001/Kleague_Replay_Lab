import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import type { JobResultCommand } from "@replay/application";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("automatic review storage", () => {
    // 데이터베이스 주소 부정 조건에 따른 처리 경로 분기
    if (!databaseUrl) return;
    // 데이터베이스 시험용 클라이언트 결과 준비
    const database = client(databaseUrl);
    afterAll(() => database.close());
    it("atomically stores blocked review with immutable evidence IDs, rejects stale bindings, and expires reads", async () => {
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID(),
            videoId = randomUUID(),
            analysisId = randomUUID(),
            jobId = randomUUID();
        // 원본 및 임대 시험용 무작위바이트 결과 준비
        const source = randomBytes(32),
            lease = randomBytes(32);
        // 현재시각 및 만료시각 시험용 2030 01 00 00 준비
        const now = "2030-01-01T00:00:00.000Z",
            expires = "2030-01-02T00:00:00.000Z";
        try {
            // 익명 세션 삽입
            await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at) values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
            // 영상 자산 삽입
            await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
            // 분석 삽입
            await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class, source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source}, 'video-baseline-v1', 'media-v1', ${now}, ${expires})`;
            // 영상 처리 작업 삽입
            await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'worker', ${lease}, ${expires}, ${now}, ${now})`;
            // 명령 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 및 작업 개정번호 1 및 임대 토큰 해시 자료 생성
            const command: JobResultCommand = {
                jobId,
                workerId: "worker",
                jobRevision: 1,
                leaseTokenHash: lease,
                now,
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: [],
                    shots: [],
                    candidates: [
                        {
                            index: 0,
                            category: "OTHER",
                            startMs: 0,
                            endMs: 1000,
                            anchorMs: 500,
                            confidence: 0.4,
                            cameraSufficiency: "LOW",
                            reasons: [],
                            shotIndices: []
                        }
                    ],
                    evidence: [
                        {
                            candidateIndex: 0,
                            kind: "FRAME",
                            contentSha256: "a".repeat(64),
                            objectKey: `evidence/${analysisId}/${jobId}/1/${"a".repeat(64)}/frame.jpg`,
                            startMs: 500,
                            endMs: 500,
                            width: null,
                            height: null
                        }
                    ]
                },
                automaticReview: {
                    version: "automatic-review-v1",
                    analysisId,
                    jobId,
                    jobRevision: 1,
                    sourceSha256: source.toString("hex"),
                    pipelineVersion: "video-baseline-v1",
                    videoCoverage: "PARTIAL",
                    summaryTruncated: false,
                    evaluatedCount: 0,
                    blockedCount: 1,
                    rows: [
                        {
                            candidateIndex: 0,
                            question: "PUSHING",
                            status: "BLOCKED",
                            reasonCodes: ["FACT_PRODUCER_UNVERIFIED"],
                            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                            evidenceIndices: [],
                            producer: null,
                            rule: null,
                            facts: null,
                            result: null
                        }
                    ]
                }
            };
            // 저장소 시험용 작업 저장소 준비
            const store = new JobStore(database, () => new Date(now));
            // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
            expect(
                await store.result({
                    ...command,
                    automaticReview: { ...command.automaticReview!, jobRevision: 2 }
                })
            ).toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });
            // 사건 후보 조회 결과의 행 수가 0개임 확인
            expect(
                await database.sql`select id from incident_candidates where analysis_id = ${analysisId}`
            ).toHaveLength(0);
            // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
            expect(await store.result(command)).toEqual({ kind: "ACCEPTED" });
            // 자동 규정 평가 기록 조회
            const [saved] =
                await database.sql`select * from analysis_automatic_reviews where analysis_id = ${analysisId}`;
            // 저장결과 근거의 1개 항목 목록의 필드 일치 확인
            expect(saved?.evidence_bindings).toMatchObject([
                { evidenceIndex: 0, candidateIndex: 0, evidenceId: expect.any(String) }
            ]);
            // 입력 조건의 잘못된 입력의 예외 발생 확인
            await expect(
                database.sql`update analysis_automatic_reviews set pipeline_version = 'tampered' where analysis_id = ${analysisId}`
            ).rejects.toThrow("append-only");
            // 상태 시험용 상태 저장소 준비
            const status = new StatusStore(database);
            // 상태 상태 결과를 화면자료에 저장
            const view = await status.status({
                anonymousSessionId: sessionId,
                videoAssetId: videoId,
                now
            });
            // 화면자료 분석 자동평가 요약의 완료 개수 0 및 보류 개수 1 자료의 필드 일치 확인
            expect(view?.analysis?.automaticReviewSummary).toMatchObject({
                completedCount: 0,
                blockedCount: 1
            });
            // 화면자료 분석 후보목록의 0개 항목 목록 기준 구조 일치 확인
            expect(view?.analysis?.candidates).toEqual([]);
            // 분석 갱신
            await database.sql`update analyses set source_fingerprint = ${randomBytes(32)} where id = ${analysisId}`;
            // 상태 상태 결과 분석 자동평가 요약의 미정의 확인
            expect(
                (await status.status({ anonymousSessionId: sessionId, videoAssetId: videoId, now }))
                    ?.analysis?.automaticReviewSummary
            ).toBeUndefined();
        } finally {
            // 근거 자산 삭제
            await database.sql`delete from evidence_assets where analysis_id = ${analysisId}`;
            // 인식 후보 사건 삭제
            await database.sql`delete from incident_candidates where analysis_id = ${analysisId}`;
            // 작업 상태 이력 삭제
            await database.sql`delete from processing_job_events where job_id = ${jobId}`;
            // 영상 처리 작업 삭제
            await database.sql`delete from processing_jobs where id = ${jobId}`;
            // 분석 삭제
            await database.sql`delete from analyses where id = ${analysisId}`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where id = ${videoId}`;
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
        }
    });
});
