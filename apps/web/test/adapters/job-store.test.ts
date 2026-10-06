import { describe, expect, it } from "vitest";
import { JobStore } from "@replay/adapters";
import type {
    EvidenceAccessCommand,
    JobClaimCommand,
    JobProgressCommand,
    JobResultCommand,
    JobResultPreflightCommand
} from "@replay/application";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
    PERCEPTION_ANALYSIS_ID,
    PERCEPTION_JOB_ID,
    PERCEPTION_SOURCE_SHA256,
    avPerceptionPayload,
    perceptionPayload
} from "../fixtures/perception";
import { liveness, livenessQuery } from "../fixtures/liveness";

// 명령 시험 입력으로 작업자 식별자 작업자 1 및 작업 유형 영상 및 현재시각 2026 08 00 00 및 임대 종료시각 2026 08 00 30 및 임대 토큰 해시 자료 생성
const command: JobClaimCommand = {
    workerId: "worker-1",
    jobType: "ANALYZE_VIDEO",
    now: "2026-08-29T00:00:00.000Z",
    leaseUntil: "2026-08-29T00:00:30.000Z",
    leaseTokenHash: Uint8Array.from([7, 8, 9]),
};

// 진행률 시험 입력으로 작업 식별자 11111111 1111 4111 8111 111111111111 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 해시 자료 생성
const progress: JobProgressCommand = {
    jobId: "11111111-1111-4111-8111-111111111111",
    workerId: "worker-1",
    jobRevision: 2,
    leaseTokenHash: Uint8Array.from([1, 2, 3]),
    stage: "DETECTING",
    progressPercent: 40,
    now: command.now,
    leaseUntil: command.leaseUntil,
    message: "candidate scan",
};

// 결과 시험 입력으로 작업 식별자 11111111 1111 4111 8111 111111111111 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 해시 자료 생성
const result: JobResultCommand = {
    jobId: "11111111-1111-4111-8111-111111111111",
    workerId: "worker-1",
    jobRevision: 2,
    leaseTokenHash: Uint8Array.from([1, 2, 3]),
    now: command.now,
    payload: {
        kind: "VALIDATED",
        durationMs: 90_000,
        width: 1920,
        height: 1080,
    },
};

// 시험자료 시험 입력으로 작업 식별자 11111111 1111 4111 8111 111111111111 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 해시 자료 생성
const access: EvidenceAccessCommand = {
    jobId: "11111111-1111-4111-8111-111111111111",
    workerId: "worker-1",
    jobRevision: 2,
    leaseTokenHash: Uint8Array.from([1, 2, 3]),
    now: command.now,
};

// 검증용 데이터베이스 구성
const database = (rows: unknown[]) => ({
    transaction: async (
        operation: (value: { execute: () => Promise<unknown[]> }) => Promise<unknown[]>
    ) => operation({ execute: async () => rows })
});

// 직전 판본 2와 시도 1을 판본 5와 시도 3으로 넘긴 선점 행이며 직전 값을 새 값에서 계산하지 않고 반환 열에서 읽음을 구분하도록 새 값과 독립된 값 사용
const takeover = (expiredAt: string | null) => ({
    id: "11111111-1111-4111-8111-111111111111",
    job_type: "ANALYZE_VIDEO",
    payload_version: 1,
    job_revision: 5,
    attempt: 3,
    stage: "SEGMENTING",
    progress_percent: 0,
    lease_until: command.leaseUntil,
    analysis_id: "22222222-2222-4222-8222-222222222222",
    video_asset_id: "33333333-3333-4333-8333-333333333333",
    object_key: "uploads/video.mp4",
    previous_revision: 2,
    previous_attempt: 1,
    expired_at: expiredAt
});

// 작업 저장소 테스트
describe("JobStore", () => {
    it("rejects newly submitted FRAME intervals before opening a transaction", async () => {
        let transactions = 0;
        const repository = new JobStore({
            db: {
                transaction: async () => {
                    transactions += 1;
                    return [{ kind: "ACCEPTED" }];
                }
            }
        } as never);
        await expect(repository.result({
            ...result,
            payload: {
                kind: "ANALYZED", pipelineVersion: "video-baseline-v1",
                limitations: [], shots: [], candidates: [],
                evidence: [{
                    candidateIndex: 0, kind: "FRAME",
                    objectKey: `evidence/analysis/job/frame.jpg`,
                    contentSha256: "d".repeat(64), startMs: 0, endMs: 100,
                    width: 1920, height: 1080
                }]
            }
        })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });
        expect(transactions).toBe(0);
    });

    it.each([
        ["rule-lock", "lease"],
        ["last-write", "lease"],
        ["rule-lock", "retention"],
        ["last-write", "retention"]
    ])(
        "rejects expiry after %s (%s) and never commits partial output",
        async (expireAt, expiredField) => {
            // 시험자료 및 시험자료 시험용 거짓 준비
            let expired = false,
                rolledBack = false;
            // 시험자료 시험용 0개 항목 목록 준비
            const writes: string[] = [];
            // 전송자료 시험 입력으로 기존 항목 및 근거 자료 생성
            const payload = { ...perceptionPayload(), evidence: [] };
            // 보존 기한 시험용 만료 필드에 따른 원본 만료 시각 준비
            const retention =
                expiredField === "retention" ? "2030-01-01T00:00:10.000Z" : "2030-01-01T01:00:00.000Z";
            // 저장소 시험용 작업 저장소 준비
            const repository = new JobStore(
                {
                    db: {
                        transaction: async (operation: (tx: unknown) => unknown) => {
                            try {
                                // 작업 결과 반환
                                return await operation({
                                    execute: async (statement: SQL) => {
                                        // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                                        const query = new PgDialect().sqlToQuery(statement);
                                        // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                                        if (query.sql.includes("for update of job"))
                                            // 1개 항목 목록 반환
                                            return [
                                                {
                                                    id: PERCEPTION_JOB_ID,
                                                    status: "PROCESSING",
                                                    job_type: "ANALYZE_VIDEO",
                                                    job_revision: 2,
                                                    attempt: 1,
                                                    lease_owner: "worker-1",
                                                    lease_token_hash: Buffer.from([1, 2, 3]),
                                                    lease_until:
                                                        expiredField === "lease"
                                                            ? "2030-01-01T00:00:10.000Z"
                                                            : "2030-01-01T01:00:00.000Z",
                                                    analysis_id: PERCEPTION_ANALYSIS_ID,
                                                    source_fingerprint: Buffer.from(
                                                        PERCEPTION_SOURCE_SHA256,
                                                        "hex"
                                                    ),
                                                    content_sha256: Buffer.from(
                                                        PERCEPTION_SOURCE_SHA256,
                                                        "hex"
                                                    ),
                                                    expires_at: retention,
                                                    match_id: "match",
                                                    applied_rule_version_id: "rule"
                                                }
                                            ];
                                        // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                                        if (livenessQuery(query))
                                            // 기준 시각과 보존 기한의 비교 결과 반환
                                            return liveness(query, PERCEPTION_JOB_ID, retention);
                                        // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                                        if (query.sql.includes("for share of rule")) {
                                            // 시점 비교 조건에 따른 처리 경로 분기
                                            if (expireAt === "rule-lock") expired = true;
                                            // 0개 항목 목록 반환
                                            return [];
                                        }
                                        // 지정 문자열 패턴 결과에 따른 처리 경로 분기
                                        if (
                                            /insert into|update analyses|update processing_jobs/.test(
                                                query.sql
                                            )
                                        )
                                            // 시험자료 추가 결과 처리 수행
                                            writes.push(query.sql);
                                        // 질의 질의 포함여부 결과 비교 조건에 따른 처리 경로 분기
                                        if (
                                            query.sql.includes(
                                                "insert into processing_job_events"
                                            ) &&
                                            expireAt === "last-write"
                                        )
                                            // 시험자료를 참 값으로 설정
                                            expired = true;
                                        // 0개 항목 목록 반환
                                        return [];
                                    }
                                });
                            } catch (error) {
                                // 시험자료를 참 값으로 설정
                                rolledBack = true;
                                // 시험자료 길이를 0 값으로 설정
                                writes.length = 0;
                                // 오류 예외 전달
                                throw error;
                            }
                        }
                    }
                } as never,
                () => new Date(expired ? "2030-01-01T00:00:11.000Z" : "2030-01-01T00:00:01.000Z")
            );
            // 저장소 결과를 출력에 저장
            const output = await repository.result({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([1, 2, 3]),
                now: "2030-01-01T00:00:01.000Z",
                payload,
                perceptionVerification: {
                    analysisId: PERCEPTION_ANALYSIS_ID,
                    sourceSha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                    admission: { status: "NOT_ADMITTED", reasons: [] }
                },
                automaticReview: {
                    version: "automatic-review-v1",
                    analysisId: PERCEPTION_ANALYSIS_ID,
                    jobId: PERCEPTION_JOB_ID,
                    jobRevision: 2,
                    sourceSha256: PERCEPTION_SOURCE_SHA256,
                    pipelineVersion: payload.pipelineVersion,
                    videoCoverage: "FULL",
                    summaryTruncated: false,
                    evaluatedCount: 0,
                    blockedCount: 1,
                    rows: [
                        {
                            candidateIndex: 1,
                            question: "PUSHING",
                            status: "BLOCKED",
                            reasonCodes: [],
                            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                            evidenceIndices: [],
                            producer: null,
                            rule: null,
                            facts: null,
                            result: null
                        }
                    ]
                }
            });
            // 만료되거나 교체된 작업 임대 및 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
            expect(output).toEqual(
                expiredField === "lease"
                    ? { kind: "STALE_LEASE" }
                    : { kind: "INVALID_RESULT", reason: "SOURCE" }
            );
            // 시험자료의 0개 항목 목록 기준 구조 일치 확인
            expect(writes).toEqual([]);
            // 시험자료의 기대값 시점 비교 조건 일치 확인
            expect(rolledBack).toBe(expireAt === "last-write");
            // 거부가 생존 조건 통과 후 지정한 만료 시점에서 발생했음 확인
            expect(expired).toBe(true);
        }
    );
    it("stores v2 audio only in the private perception summary envelope", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 전송자료 시험용 인식 전송자료 결과 준비
        const payload = avPerceptionPayload();
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(
            {
                db: {
                    transaction: async (operation: (tx: unknown) => unknown) =>
                        operation({
                            execute: async (statement: SQL) => {
                                // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                                const query = new PgDialect().sqlToQuery(statement);
                                // 질의목록 추가 결과 처리 수행
                                queries.push(query);
                                // 질의목록 길이 비교 조건에 따른 처리 경로 분기
                                if (queries.length === 1)
                                    // 1개 항목 목록 반환
                                    return [
                                        {
                                            id: PERCEPTION_JOB_ID,
                                            status: "PROCESSING",
                                            job_type: "ANALYZE_VIDEO",
                                            job_revision: 2,
                                            attempt: 1,
                                            lease_owner: "worker-1",
                                            lease_token_hash: Buffer.from([1, 2, 3]),
                                            lease_until: "2030-01-01T00:00:00.000Z",
                                            analysis_id: PERCEPTION_ANALYSIS_ID,
                                            source_fingerprint: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            content_sha256: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            expires_at: "2030-01-01T00:00:00.000Z"
                                        }
                                    ];
                                // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                                if (livenessQuery(query))
                                    // 기준 시각과 보존 기한의 비교 결과 반환
                                    return liveness(
                                        query,
                                        PERCEPTION_JOB_ID,
                                        "2030-01-01T00:00:00.000Z"
                                    );
                                // 질의 질의 포함여부 결과 비교 조건에 따른 처리 경로 분기
                                if (
                                    query.sql.includes("select id") &&
                                    query.sql.includes("incident_candidates")
                                ) {
                                    // 1개 항목 목록 반환
                                    return [{ id: "55555555-5555-4555-8555-555555555555" }];
                                }
                                // 0개 항목 목록 반환
                                return [];
                            }
                        })
                }
            } as never,
            () => new Date("2026-09-03T00:00:05.000Z")
        );
        // 관측이나 처리 실패의 저장 접수 성공이며 파울 판정 승인과 별개임 확인
        await expect(
            repository.result({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([1, 2, 3]),
                now: "2026-09-03T00:00:05.000Z",
                payload,
                perceptionVerification: {
                    analysisId: PERCEPTION_ANALYSIS_ID,
                    sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                    admission: {
                        status: "NOT_ADMITTED",
                        reasons: ["AUDIO_CUE_METHOD_NOT_VERIFIED"]
                    }
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 삽입 시험용 질의목록 조회 결과 준비
        const insert = queries.find((query) =>
            query.sql.includes("insert into analysis_perception_runs")
        );
        // 삽입 인자목록의 인식 실행 포함 확인
        expect(insert?.params).toContain("perception-run-v2");
        // 삽입 인자목록의 영상 로컬자료 포함 확인
        expect(insert?.params).toContain("video-local-observers-av-v1");
        // 규정 입력 채택 거부 및 음향 단서 방법 미검증 값이 결과에 포함됨 확인
        expect(insert?.params).toContain(
            JSON.stringify({
                ...payload.perception!.summary,
                processingStatus: payload.perception!.processingStatus,
                // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
                coverage: payload.perception!.coverage,
                // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
                incidents: payload.perception!.incidents,
                audio: (payload.perception as any).audio,
                admission: { status: "NOT_ADMITTED", reasons: ["AUDIO_CUE_METHOD_NOT_VERIFIED"] }
            })
        );
        // 질의목록 조회 결과 인자목록의 음향 관측목록 미포함 확인
        expect(
            queries.find((query) => query.sql.includes("update analyses"))?.params
        ).not.toContain("audio-observations-v1");
    });
    it("stores the corner observation JSON separately from the review scenario", async () => {
        // 장면 사건 시험 입력으로 종류 및 상태 및 시작시각 600 및 종료시각 1400 자료 생성
        const sceneEvent = {
            kind: "CORNER_KICK" as const,
            status: "OBSERVED" as const,
            startMs: 600,
            endMs: 1400,
            restartMs: 1000,
            evidenceTimestampsMs: [600, 900, 1100, 1400],
            method: "corner-geometry-motion-v1" as const
        };
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                            const query = new PgDialect().sqlToQuery(statement);
                            // 질의목록 추가 결과 처리 수행
                            queries.push(query);
                            // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                            if (livenessQuery(query))
                                // 기준 시각과 보존 기한의 비교 결과 반환
                                return liveness(query, result.jobId, "2030-01-01T00:00:00Z");
                            // 입력 조건 반환
                            return queries.length === 1
                                ? [
                                      {
                                          id: result.jobId,
                                          status: "PROCESSING",
                                          job_type: "ANALYZE_VIDEO",
                                          job_revision: result.jobRevision,
                                          attempt: 1,
                                          lease_owner: result.workerId,
                                          lease_token_hash: Buffer.from(result.leaseTokenHash),
                                          lease_until: "2030-01-01T00:00:00Z",
                                          analysis_id: "22222222-2222-4222-8222-222222222222"
                                      }
                                  ]
                                : [];
                        }
                    })
            }
        } as never);
        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            repository.result({
                ...result,
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: [],
                    shots: [],
                    evidence: [],
                    candidates: [
                        {
                            index: 1,
                            category: "OTHER",
                            startMs: 500,
                            endMs: 1500,
                            anchorMs: 1000,
                            confidence: 0.5,
                            cameraSufficiency: "MEDIUM",
                            reasons: [],
                            shotIndices: [],
                            sceneEvent
                        }
                    ]
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 삽입 시험용 질의목록 조회 결과 준비
        const insert = queries.find((query) =>
            query.sql.includes("insert into incident_candidates")
        );
        // 삽입 질의의 장면 사건 포함 확인
        expect(insert?.sql).toContain("scene_event");
        // 삽입 인자목록의 응답본문 직렬화 결과 포함 확인
        expect(insert?.params).toContain(JSON.stringify(sceneEvent));
        // 삽입 인자목록의 지정 문자열 포함 확인
        expect(insert?.params).toContain("OTHER");
    });
    it("does not infer a match rule edition from the upload clock", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의목록 추가 결과 처리 수행
                            queries.push(new PgDialect().sqlToQuery(statement).sql);
                            // 1개 항목 목록 반환
                            return [{ kind: "ACCEPTED" }];
                        }
                    })
            }
        } as never);
        // 저장소 결과 처리 수행
        await repository.result(result);
        // 질의목록 중 선택 항목의 규정 버전 식별자 포함 확인
        expect(queries[0]).toContain("NULL::uuid as applied_rule_version_id");
        // 질의목록 중 선택 항목의 변환 대회 규정 미포함 확인
        expect(queries[0]).not.toContain("from competition_rule_versions");
    });

    it("completes an empty pipeline output without waiting for user facts", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                            const query = new PgDialect().sqlToQuery(statement);
                            // 질의목록 추가 결과 처리 수행
                            queries.push(query.sql);
                            // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                            if (livenessQuery(query))
                                // 기준 시각과 보존 기한의 비교 결과 반환
                                return liveness(query, result.jobId, "2030-01-01T00:00:00Z");
                            // 입력 조건 반환
                            return queries.length === 1
                                ? [
                                      {
                                          id: result.jobId,
                                          status: "PROCESSING",
                                          job_type: "ANALYZE_VIDEO",
                                          job_revision: result.jobRevision,
                                          attempt: 1,
                                          lease_owner: result.workerId,
                                          lease_token_hash: Buffer.from(result.leaseTokenHash),
                                          lease_until: "2030-01-01T00:00:00Z",
                                          analysis_id: "22222222-2222-4222-8222-222222222222"
                                      }
                                  ]
                                : [];
                        }
                    })
            }
        } as never);
        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            repository.result({
                ...result,
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-baseline-v1",
                    limitations: [],
                    shots: [],
                    candidates: [],
                    evidence: []
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 갱신 시험용 질의목록 조회 결과 준비
        const update = queries.find((query) => query.includes("update analyses"));
        // 갱신의 상태 완료 포함 확인
        expect(update).toContain("status = 'COMPLETED'");
        // 갱신의 완료 시점 미포함 확인
        expect(update).not.toContain("completed_at = null");
    });
    it("maps a claimed row and stores only the given lease token hash", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의목록 추가 결과 처리 수행
                            queries.push(new PgDialect().sqlToQuery(statement));
                            // 선점된 작업 행 반환
                            return [
                                {
                                    id: "11111111-1111-4111-8111-111111111111",
                                    job_type: "ANALYZE_VIDEO",
                                    payload_version: 1,
                                    job_revision: 2,
                                    attempt: 1,
                                    stage: "SEGMENTING",
                                    progress_percent: 0,
                                    lease_until: command.leaseUntil,
                                    analysis_id: "22222222-2222-4222-8222-222222222222",
                                    video_asset_id: "33333333-3333-4333-8333-333333333333",
                                    object_key: "uploads/video.mp4",
                                    previous_revision: 1,
                                    previous_attempt: 0,
                                    expired_at: null
                                }
                            ];
                        }
                    })
            }
        } as never);

        // 저장소 작업선점 결과를 결과에 저장
        const result = await repository.claim(command);

        // 결과의 작업 식별자 11111111 1111 4111 8111 111111111111 및 작업 유형 영상 및 작업 개정번호 2 및 시도 1 자료의 필드 일치 확인
        expect(result).toMatchObject({
            jobId: "11111111-1111-4111-8111-111111111111",
            jobType: "ANALYZE_VIDEO",
            jobRevision: 2,
            attempt: 1,
            leaseUntil: command.leaseUntil,
            objectKey: "uploads/video.mp4"
        });
        // 저장소가 원문 임대 토큰을 만들거나 돌려주지 않음 확인
        expect(result).not.toHaveProperty("leaseToken");
        // 선점 갱신 문장이 받은 해시 바이트를 그대로 저장함 확인
        expect(queries[2]?.params).toContainEqual(Buffer.from(command.leaseTokenHash));
    });

    it.each([
        { taken: "a queued job", expiredAt: null, events: ["CLAIMED"] },
        {
            taken: "an expired lease",
            expiredAt: "2026-08-28T23:59:30.000Z",
            events: ["REQUEUED", "CLAIMED"]
        }
    ] as const)("ends the previous attempt only when taking over $taken", async ({
        expiredAt,
        events
    }) => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 잠근 행의 직전 판본과 시도를 다음 시도로 넘긴 선점 행 준비
        const row = takeover(expiredAt);
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의목록 추가 결과 처리 수행
                            queries.push(new PgDialect().sqlToQuery(statement));
                            // 선점된 작업 행 반환
                            return [row];
                        }
                    })
            }
        } as never);

        // 새 판본과 시도로 선점됨 확인
        await expect(repository.claim(command)).resolves.toMatchObject({
            jobRevision: 5,
            attempt: 3
        });
        // 선점 문장이 잠근 행의 직전 판본 반환 확인
        expect(queries[2]?.sql).toContain("picked.job_revision as previous_revision");
        // 선점 문장이 잠근 행의 직전 시도 반환 확인
        expect(queries[2]?.sql).toContain("picked.attempt as previous_attempt");
        // 선점 문장이 처리 중이던 행의 임대 기한만 만료 시각으로 반환 확인
        expect(queries[2]?.sql).toContain(
            "case when picked.status = 'PROCESSING' then picked.lease_until end as expired_at"
        );
        // 선점 문장 뒤 이벤트 기록 순서 확인
        expect(
            queries.slice(3).map((query) => /'(REQUEUED|CLAIMED)'/.exec(query.sql)?.[1])
        ).toEqual(events);
        // 만료 임대를 넘겨받은 경우에만 직전 판본과 시도의 시간 초과 재대기를 만료 시각에 기록 확인
        expect(queries.slice(3, -1).map((query) => query.params)).toEqual(
            expiredAt === null ? [] : [[row.id, 2, 1, "WORKER_TIMEOUT", expiredAt]]
        );
        // 선점 이벤트는 새 판본과 시도로 현재 시각에 기록됨 확인
        expect(queries.at(-1)?.params).toEqual([row.id, 5, 3, "SEGMENTING", 0, command.now]);
    });

    it("fails the claim when the expired attempt cannot be ended", async () => {
        // 실행 문장 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 재대기 이벤트 기록만 거절하는 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 실행 문장 변환
                            const query = new PgDialect().sqlToQuery(statement).sql;
                            // 실행 문장 기록
                            queries.push(query);
                            // 재대기 이벤트 기록 거절
                            if (query.includes("'REQUEUED'")) throw new Error("event rejected");
                            // 만료 임대를 넘겨받은 선점 행 반환
                            return [takeover("2026-08-28T23:59:30.000Z")];
                        }
                    })
            }
        } as never);

        // 재대기 이벤트 기록 실패가 선점 실패로 전달됨 확인
        await expect(repository.claim(command)).rejects.toThrow("event rejected");
        // 이력 없는 넘겨받기를 막도록 선점 이벤트를 기록하지 않음 확인
        expect(queries.some((query) => query.includes("'CLAIMED'"))).toBe(false);
    });

    it("does not skip the expired attempt when the claim row lacks the expiry column", async () => {
        // 실행 문장 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 선점 문장 반환 열이 바뀌어 만료 시각이 빠진 선점 행 준비
        const { expired_at: _expiredAt, ...row } = takeover(null);
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 실행 문장 기록
                            queries.push(new PgDialect().sqlToQuery(statement));
                            // 만료 시각 열이 없는 선점 행 반환
                            return [row];
                        }
                    })
            }
        } as never);

        // 저장소 작업선점 실행
        await repository.claim(command);
        // 열 누락을 대기 작업 선점으로 통과시키지 않고 재대기 이벤트 기록으로 진입 확인
        expect(queries[3]?.sql).toContain("'REQUEUED'");
        // 만료 시각을 지어내지 않고 인자에서 제외함 확인
        expect(queries[3]?.params).toEqual([row.id, 2, 1, "WORKER_TIMEOUT"]);
        // 빈 시각 자리로 데이터베이스가 문장을 거절해 선점 전체가 되돌려지는 형태 확인
        expect(queries[3]?.sql).toMatch(/\$4,\s*\)/);
    });

    it("returns null when the queue has no eligible row", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({ db: database([]) } as never);

        // 저장소 작업선점 결과의 빈 값 확인
        await expect(repository.claim(command)).resolves.toBeNull();
    });

    it("closes exhausted and unrecoverable jobs before leasing only a live target", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의목록 추가 결과 처리 수행
                            queries.push(new PgDialect().sqlToQuery(statement));
                            // 선점 가능한 작업 없음 반환
                            return [];
                        }
                    })
            }
        } as never);

        // 선점 대상이 없으면 빈 값 확인
        await expect(repository.claim(command)).resolves.toBeNull();
        // 마지막 시도에서 만료된 작업의 시간 초과 종료가 먼저 실행됨 확인
        expect(queries[0]?.params).toContain("WORKER_TIMEOUT");
        // 되살릴 수 없는 작업이 생존 조건의 부정으로 선택되어 원본 사용 불가로 종료됨 확인
        expect(queries[1]?.sql).toContain("and not (case job.job_type");
        // 원본 사용 불가 종료 사유 전달 확인
        expect(queries[1]?.params).toContain("SOURCE_UNAVAILABLE");
        // 선점 대상 선택이 생존 조건을 요구하고 잠긴 행을 건너뜀 확인
        expect(queries[2]?.sql).toMatch(/and \(case job\.job_type[\s\S]*for update skip locked/);
        // 선점 대상이 없으면 선점 이벤트를 기록하지 않음 확인
        expect(queries).toHaveLength(3);
    });

    it("maps a progress update returned by the transaction", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: database([
                {
                    stage: "DETECTING",
                    progress_percent: 40,
                    heartbeat_at: command.now,
                    lease_until: command.leaseUntil
                }
            ])
        } as never);

        // 저장소 진행률 결과의 종류 지정 문자열 및 단계 지정 문자열 및 진행률 백분율 40 및 시점 자료 기준 구조 일치 확인
        await expect(repository.progress(progress)).resolves.toEqual({
            kind: "UPDATED",
            stage: "DETECTING",
            progressPercent: 40,
            heartbeatAt: command.now,
            leaseUntil: command.leaseUntil
        });
    });

    it("maps an accepted validation result", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({ db: database([{ kind: "ACCEPTED" }]) } as never);

        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(repository.result(result)).resolves.toEqual({ kind: "ACCEPTED" });
    });

    it("maps a stale validation lease", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({ db: database([{ kind: "STALE_LEASE" }]) } as never);

        // 만료되거나 교체된 작업 임대 내용을 포함한 기대 결과 일치 확인
        await expect(repository.result(result)).resolves.toEqual({ kind: "STALE_LEASE" });
    });

    it.each<[string, string | undefined, string | null]>([
        ["binds the retry time", "2026-08-29T00:00:30.000Z", "2026-08-29T00:00:30.000Z"],
        ["binds no retry time", undefined, null]
    ])("%s into one requeue or terminal failure statement", async (_name, retryAt, bound) => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (statement: SQL) => {
                            // 질의목록 추가 결과 처리 수행
                            queries.push(new PgDialect().sqlToQuery(statement));
                            // 접수 결과 반환
                            return [{ kind: "ACCEPTED" }];
                        }
                    })
            }
        } as never);

        // 재시도 가능한 실패 결과 저장 접수 확인
        await expect(
            repository.result({
                ...result,
                payload: { kind: "FAILED", failureCode: "WORKER_TRANSIENT_ERROR", retryable: true },
                ...(retryAt ? { retryAt } : {})
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 재대기와 최종 실패를 하나의 문장에서 결정 확인
        expect(queries).toHaveLength(1);
        // 재선점 시각과 남은 시도 및 원본 생존을 모두 갖춘 경우만 재대기 확인
        expect(queries[0]?.sql).toMatch(
            /::timestamptz is not null\s+and target\.attempt < target\.max_attempts\s+and target\.live/
        );
        // 재대기하지 않는 임대만 최종 실패로 닫음 확인
        expect(queries[0]?.sql).toContain("where job.id = leased.id and not leased.requeue");
        // 재대기 이력을 최종 실패 이력과 다른 이벤트로 기록 확인
        expect(queries[0]?.sql).toContain("'REQUEUED', 'QUEUED', 0");
        // 재대기 판단과 다음 선점 시각 두 곳에만 같은 재선점 시각 전달 확인
        expect(queries[0]?.params.filter((value) => value === bound)).toHaveLength(2);
    });

    it("maps authorized analysis evidence access", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                execute: async (statement: SQL) => {
                    // 질의목록 추가 결과 처리 수행
                    queries.push(new PgDialect().sqlToQuery(statement));
                    // 보존 규칙 안의 임대 작업 행 반환
                    return [{ analysis_id: "22222222-2222-4222-8222-222222222222", live: true }];
                }
            }
        } as never);

        // 저장소 결과의 종류 지정 문자열 및 분석 식별자 22222222 2222 4222 8222 222222222222 자료 기준 구조 일치 확인
        await expect(repository.access(access)).resolves.toEqual({
            kind: "AUTHORIZED",
            analysisId: "22222222-2222-4222-8222-222222222222"
        });
        // 접근 권한 질의가 작업 대상 생존 조건을 함께 평가함 확인
        expect(queries[0]?.sql).toContain("case job.job_type");
    });

    it("refuses evidence access when the leased target left retention", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                execute: async () => [
                    { analysis_id: "22222222-2222-4222-8222-222222222222", live: false }
                ]
            }
        } as never);

        // 임대가 유효해도 보존 규칙을 벗어난 원본은 증거 권한 대신 원본 사용 불가 확인
        await expect(repository.access(access)).resolves.toEqual({ kind: "SOURCE_UNAVAILABLE" });
    });

    it("preflights the active lease with authoritative and copied source hashes without locking", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 사전점검 시험 입력으로 기존 항목 및 작업 식별자 자료 생성
        const preflight: JobResultPreflightCommand = { ...access, jobId: PERCEPTION_JOB_ID };
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                execute: async (statement: SQL) => {
                    // 질의목록 추가 결과 처리 수행
                    queries.push(new PgDialect().sqlToQuery(statement));
                    // 1개 항목 목록 반환
                    return [
                        {
                            analysis_id: PERCEPTION_ANALYSIS_ID,
                            content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                            source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                            expires_at: "2026-09-04T00:00:00.000Z",
                            match_id: "33333333-3333-4333-8333-333333333333",
                            ifab_edition: "2026-27",
                            rule_version_id: "44444444-4444-4444-8444-444444444444",
                            verification_status: "VERIFIED",
                            live: true
                        }
                    ];
                }
            }
        } as never);

        // 저장소 사전점검 결과의 종류 지정 문자열 및 분석 식별자 및 원본 해시 및 분석 원본 해시 자료 기준 구조 일치 확인
        await expect(repository.preflight(preflight)).resolves.toEqual({
            kind: "AUTHORIZED",
            analysisId: PERCEPTION_ANALYSIS_ID,
            sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
            analysisSourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
            expiresAt: "2026-09-04T00:00:00.000Z",
            // 경기와 연결된 규정 판본의 검증 맥락 구성
            ruleEdition: {
                id: "44444444-4444-4444-8444-444444444444",
                // 해당 자료의 검증 완료 상태이며 모든 인식 사실의 승인을 뜻하지 않음
                verificationStatus: "VERIFIED",
                matchId: "33333333-3333-4333-8333-333333333333",
                ifabEdition: "2026-27"
            }
        });
        // 질의목록 중 선택 항목 질의의 경로결합 분석목록 포함 확인
        expect(queries[0]?.sql).toContain("join analyses");
        // 질의목록 중 선택 항목 질의의 경로결합 영상 포함 확인
        expect(queries[0]?.sql).toContain("join video_assets");
        // 질의목록 중 선택 항목 질의의 갱신 미포함 확인
        expect(queries[0]?.sql).not.toContain("for update");
        // 사전 검사 질의가 작업 대상 생존 조건을 함께 평가함 확인
        expect(queries[0]?.sql).toContain("case job.job_type");
    });

    it("rejects preflight before heavy checks when the leased target left retention", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                execute: async (statement: SQL) => {
                    // 질의목록 추가 결과 처리 수행
                    queries.push(new PgDialect().sqlToQuery(statement).sql);
                    // 보존 규칙을 벗어난 임대 작업 행 반환
                    return [
                        {
                            analysis_id: PERCEPTION_ANALYSIS_ID,
                            content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                            source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                            expires_at: "2026-09-04T00:00:00.000Z",
                            match_id: null,
                            ifab_edition: null,
                            rule_version_id: null,
                            verification_status: null,
                            live: false
                        }
                    ];
                }
            }
        } as never);

        // 임대가 유효해도 보존 규칙을 벗어난 원본은 원본 거부 확인
        await expect(
            repository.preflight({ ...access, jobId: PERCEPTION_JOB_ID })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 원본 거부 뒤 문맥 연결이나 상태 조회 질의 없음 확인
        expect(queries).toHaveLength(1);
    });

    it("keeps a VERIFIED edition unverified when the analysis has no verified match context", async () => {
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                execute: async () => [
                    {
                        analysis_id: PERCEPTION_ANALYSIS_ID,
                        content_sha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                        source_fingerprint: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
                        expires_at: "2026-09-04T00:00:00.000Z",
                        match_id: null,
                        ifab_edition: "2026-27",
                        rule_version_id: "44444444-4444-4444-8444-444444444444",
                        verification_status: "VERIFIED",
                        live: true
                    }
                ]
            }
        } as never);

        // 저장소 사전점검 결과의 종류 지정 문자열 및 규정 판본 빈 값 자료의 필드 일치 확인
        await expect(
            repository.preflight({ ...access, jobId: PERCEPTION_JOB_ID })
        ).resolves.toMatchObject({
            kind: "AUTHORIZED",
            // 경기와 연결된 규정 판본의 검증 맥락 구성
            ruleEdition: null
        });
    });

    it("atomically persists the private run and NOT_ADMITTED result after source and lease recheck", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 전송자료 시험용 인식전송자료 결과 준비
        const payload = perceptionPayload();
        // 명령 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 해시 자료 생성
        const command: JobResultCommand = {
            jobId: PERCEPTION_JOB_ID,
            workerId: "worker-1",
            jobRevision: 2,
            leaseTokenHash: Uint8Array.from([1, 2, 3]),
            now: "2026-09-03T00:00:05.000Z",
            payload,
            perceptionVerification: {
                analysisId: PERCEPTION_ANALYSIS_ID,
                sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                admission: { status: "NOT_ADMITTED", reasons: ["CONTACT_METHOD_NOT_VERIFIED"] }
            }
        };
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(
            {
                db: {
                    transaction: async (operation: (tx: unknown) => unknown) =>
                        operation({
                            execute: async (statement: SQL) => {
                                // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                                const query = new PgDialect().sqlToQuery(statement);
                                // 질의목록 추가 결과 처리 수행
                                queries.push(query);
                                // 질의목록 길이 비교 조건에 따른 처리 경로 분기
                                if (queries.length === 1)
                                    // 1개 항목 목록 반환
                                    return [
                                        {
                                            id: PERCEPTION_JOB_ID,
                                            status: "PROCESSING",
                                            job_type: "ANALYZE_VIDEO",
                                            job_revision: 2,
                                            attempt: 1,
                                            lease_owner: "worker-1",
                                            lease_token_hash: Buffer.from([1, 2, 3]),
                                            lease_until: "2030-01-01T00:00:00.000Z",
                                            analysis_id: PERCEPTION_ANALYSIS_ID,
                                            source_fingerprint: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            content_sha256: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            expires_at: "2026-09-04T00:00:00.000Z"
                                        }
                                    ];
                                // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                                if (livenessQuery(query))
                                    // 기준 시각과 보존 기한의 비교 결과 반환
                                    return liveness(
                                        query,
                                        PERCEPTION_JOB_ID,
                                        "2026-09-04T00:00:00.000Z"
                                    );
                                // 질의 질의 포함여부 결과 비교 조건에 따른 처리 경로 분기
                                if (
                                    query.sql.includes("select id") &&
                                    query.sql.includes("incident_candidates")
                                ) {
                                    // 1개 항목 목록 반환
                                    return [{ id: "55555555-5555-4555-8555-555555555555" }];
                                }
                                // 0개 항목 목록 반환
                                return [];
                            }
                        })
                }
            } as never,
            () => new Date(command.now)
        );

        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(repository.result(command)).resolves.toEqual({ kind: "ACCEPTED" });
        // 질의목록 중 선택 항목 질의의 갱신 작업 분석 영상 포함 확인
        expect(queries[0]?.sql).toContain("for update of job, analysis, video");
        // 인식 삽입 시험용 질의목록 조회 결과 준비
        const perceptionInsert = queries.find((query) =>
            query.sql.includes("insert into analysis_perception_runs")
        );
        // 인식 삽입 인자목록의 응답본문 직렬화 결과 포함 확인
        expect(perceptionInsert?.params).toContain(JSON.stringify(payload.perception!.models));
        // 저장 인자에 접촉 인식 방법 미검증 사유 포함 확인
        expect(
            perceptionInsert?.params.some(
                (param) =>
                    typeof param === "string" && param.includes("CONTACT_METHOD_NOT_VERIFIED")
            )
        ).toBe(true);
        // 인식 순번 시험용 질의목록 조회 순번 결과 준비
        const perceptionIndex = queries.findIndex((query) =>
            query.sql.includes("insert into analysis_perception_runs")
        );
        // 완료 순번 시험용 질의목록 조회 순번 결과 준비
        const completeIndex = queries.findIndex((query) => query.sql.includes("update analyses"));
        // 인식 순번의 0 초과 확인
        expect(perceptionIndex).toBeGreaterThan(0);
        // 완료 순번의 인식 순번 초과 확인
        expect(completeIndex).toBeGreaterThan(perceptionIndex);
    });

    it("returns INVALID_RESULT before inserts when the transaction source recheck differs", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 전송자료 시험용 인식전송자료 결과 준비
        const payload = perceptionPayload();
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(
            {
                db: {
                    transaction: async (operation: (tx: unknown) => unknown) =>
                        operation({
                            execute: async (statement: SQL) => {
                                // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                                const query = new PgDialect().sqlToQuery(statement);
                                // 질의목록 추가 결과 처리 수행
                                queries.push(query.sql);
                                // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                                if (livenessQuery(query))
                                    // 기준 시각과 보존 기한의 비교 결과 반환
                                    return liveness(
                                        query,
                                        PERCEPTION_JOB_ID,
                                        "2026-09-04T00:00:00.000Z"
                                    );
                                // 1개 항목 목록 반환
                                return [
                                    {
                                        id: PERCEPTION_JOB_ID,
                                        status: "PROCESSING",
                                        job_type: "ANALYZE_VIDEO",
                                        job_revision: 2,
                                        attempt: 1,
                                        lease_owner: "worker-1",
                                        lease_token_hash: Buffer.from([1, 2, 3]),
                                        lease_until: "2030-01-01T00:00:00.000Z",
                                        analysis_id: PERCEPTION_ANALYSIS_ID,
                                        source_fingerprint: Buffer.from("d".repeat(64), "hex"),
                                        content_sha256: Buffer.from("d".repeat(64), "hex"),
                                        expires_at: "2026-09-04T00:00:00.000Z"
                                    }
                                ];
                            }
                        })
                }
            } as never,
            // 보존 기한 이전의 고정 시각으로 생존 조건을 통과시켜 원본 해시 불일치 경로 확인
            () => new Date("2026-09-03T00:00:05.000Z")
        );
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            repository.result({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([1, 2, 3]),
                now: "2026-09-03T00:00:05.000Z",
                payload,
                perceptionVerification: {
                    analysisId: PERCEPTION_ANALYSIS_ID,
                    sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                    admission: { status: "NOT_ADMITTED", reasons: [] }
                }
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 잠금과 생존 조건 질의만 실행되고 원본 해시 불일치로 쓰기 전에 거부됨 확인
        expect(queries.map((sql) => livenessQuery({ sql }))).toEqual([false, true]);
    });

    it.each([
        {
            name: "lease expired while waiting",
            leaseUntil: "2026-09-03T00:00:00.030Z",
            expiresAt: "2026-09-03T00:00:01.000Z",
            liveAt: null,
            expected: { kind: "STALE_LEASE" }
        },
        {
            name: "retention expired while waiting",
            leaseUntil: "2026-09-03T00:00:01.000Z",
            expiresAt: "2026-09-03T00:00:00.030Z",
            liveAt: "2026-09-03T00:00:00.080Z",
            expected: { kind: "INVALID_RESULT", reason: "SOURCE" }
        },
        {
            name: "lease and retention remain active",
            leaseUntil: "2026-09-03T00:00:01.000Z",
            expiresAt: "2026-09-03T00:00:02.000Z",
            liveAt: "2026-09-03T00:00:00.080Z",
            expected: { kind: "ACCEPTED" }
        }
    ])("uses fresh post-lock wall time when $name", async ({
        leaseUntil,
        expiresAt,
        liveAt,
        expected
    }) => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 반환여부 시험용 거짓 준비
        let lockReturned = false;
        // 전송자료 시험용 인식전송자료 결과 준비
        const payload = perceptionPayload();
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(
            {
                db: {
                    transaction: async (operation: (tx: unknown) => unknown) =>
                        operation({
                            execute: async (statement: SQL) => {
                                // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                                const query = new PgDialect().sqlToQuery(statement);
                                // 질의목록 추가 결과 처리 수행
                                queries.push(query);
                                // 질의목록 길이 비교 조건에 따른 처리 경로 분기
                                if (queries.length === 1) {
                                    // 비동기결과 처리 수행
                                    await new Promise((resolve) => setTimeout(resolve, 20));
                                    // 반환여부를 참 값으로 설정
                                    lockReturned = true;
                                    // 1개 항목 목록 반환
                                    return [
                                        {
                                            id: PERCEPTION_JOB_ID,
                                            status: "PROCESSING",
                                            job_type: "ANALYZE_VIDEO",
                                            job_revision: 2,
                                            attempt: 1,
                                            lease_owner: "worker-1",
                                            lease_token_hash: Buffer.from([1, 2, 3]),
                                            lease_until: leaseUntil,
                                            analysis_id: PERCEPTION_ANALYSIS_ID,
                                            source_fingerprint: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            content_sha256: Buffer.from(
                                                PERCEPTION_SOURCE_SHA256,
                                                "hex"
                                            ),
                                            expires_at: expiresAt
                                        }
                                    ];
                                }
                                // 잠금 이후 생존 조건 질의에 보존 기한 비교 결과 응답
                                if (livenessQuery(query))
                                    // 기준 시각과 보존 기한의 비교 결과 반환
                                    return liveness(query, PERCEPTION_JOB_ID, expiresAt);
                                // 질의 질의 포함여부 결과 비교 조건에 따른 처리 경로 분기
                                if (
                                    query.sql.includes("select id") &&
                                    query.sql.includes("incident_candidates")
                                ) {
                                    // 1개 항목 목록 반환
                                    return [{ id: "55555555-5555-4555-8555-555555555555" }];
                                }
                                // 0개 항목 목록 반환
                                return [];
                            }
                        })
                }
            } as never,
            () => {
                // 반환여부의 기대값 참 일치 확인
                expect(lockReturned).toBe(true);
                // 날짜 반환
                return new Date("2026-09-03T00:00:00.080Z");
            }
        );
        // 저장소 결과를 값에 저장
        const value = await repository.result({
            jobId: PERCEPTION_JOB_ID,
            workerId: "worker-1",
            jobRevision: 2,
            leaseTokenHash: Uint8Array.from([1, 2, 3]),
            now: "2026-09-03T00:00:00.000Z",
            payload,
            perceptionVerification: {
                analysisId: PERCEPTION_ANALYSIS_ID,
                sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                admission: { status: "NOT_ADMITTED", reasons: ["CONTACT_METHOD_NOT_VERIFIED"] }
            }
        });

        // 값의 기대값 기준 구조 일치 확인
        expect(value).toEqual(expected);
        // 생존 조건 질의가 잠금 이후 벽시계로 평가되거나 임대 만료로 실행되지 않음 확인
        expect(queries.find(livenessQuery)?.params[0] ?? null).toBe(liveAt);
        // 값 종류 비교 조건에 따른 처리 경로 분기
        if (value.kind === "ACCEPTED") {
            // 완료처리 시험용 질의목록 조회 결과 준비
            const completion = queries.find((query) => query.sql.includes("update analyses"));
            // 완료처리 인자목록의 2026 09 00 00 포함 확인
            expect(completion?.params).toContain("2026-09-03T00:00:00.080Z");
        } else {
            // 거부 결과는 잠금과 필요한 생존 조건 질의만 실행하고 쓰기 없음 확인
            expect(queries).toHaveLength(liveAt ? 2 : 1);
        }
    });

    it("rejects a private summary envelope larger than 1 MiB before opening a transaction", async () => {
        // 시험자료 시험용 0 준비
        let transactions = 0;
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore({
            db: {
                transaction: async () => {
                    // 시험자료를 1 값으로 설정
                    transactions += 1;
                    // 1개 항목 목록 반환
                    return [{ kind: "ACCEPTED" }];
                }
            }
        } as never);
        // 전송자료 시험용 인식전송자료 결과 준비
        const payload = perceptionPayload();

        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            repository.result({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([1, 2, 3]),
                now: "2026-09-03T00:00:00.000Z",
                payload,
                perceptionVerification: {
                    analysisId: PERCEPTION_ANALYSIS_ID,
                    sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                    admission: { status: "NOT_ADMITTED", reasons: ["x".repeat(1_048_576)] }
                }
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "CONTEXT" });
        // 시험자료의 기대값 0 일치 확인
        expect(transactions).toBe(0);
    });
});
