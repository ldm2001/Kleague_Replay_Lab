import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { python } from "../../../../scripts/python.mjs";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { report, result, type AnalysisPayload } from "@replay/application";
import {
    broadcastCueData,
    sceneEventData,
    WORKER_PROTOCOL,
    type BroadcastCue
} from "@replay/shared-types";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";
import { knownVideoSource } from "../../src/adapters/sources";
import { judgment } from "../fixtures/result";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 현재시각 시험용 2030 01 00 00 준비
const NOW = "2030-01-01T12:00:00.000Z";
// 만료시각 시험용 2030 01 00 00 준비
const EXPIRES = "2030-01-02T12:00:00.000Z";
// 원본 해시 시험용 지정 문자열 준비
const SOURCE_SHA256 = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";
// 해시계산기 시험 입력으로 해시 자료 생성
const hasher = {
    sha256: async (value: string) => new Uint8Array(createHash("sha256").update(value).digest())
};
// 방송 단서 시험 입력으로 종류 지정 문자열 및 방법 방송 및 시작시각 600 및 종료시각 1400 자료 생성
const broadcastCue: BroadcastCue = {
    kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 600, endMs: 1400,
    evidenceTimestampsMs: [600, 1000, 1400],
};

// 검증용 합성 입력 구성
function synthetic(analysisId: string, jobId: string): AnalysisPayload {
    // 종류 지정 문자열 및 파이프라인 버전 영상 기준자료 및 한계목록 및 샷목록 자료 반환
    return {
        kind: "ANALYZED",
        pipelineVersion: "video-baseline-v1",
        limitations: [],
        shots: [
            {
                index: 0,
                startMs: 0,
                endMs: 2000,
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
                confidence: 0.5,
                cameraSufficiency: "MEDIUM",
                reasons: [],
                shotIndices: [0],
                ...{ broadcastCue }
            }
        ],
        evidence: [
            {
                candidateIndex: 1,
                kind: "CLIP",
                objectKey: `evidence/${analysisId}/${jobId}/clip.mp4`,
                contentSha256: "ab".repeat(32),
                startMs: 500,
                endMs: 1500,
                width: 640,
                height: 360
            }
        ]
    };
}

describe("broadcast scope adapter contracts", () => {
    // 후보 행 시험 입력으로 식별자 11111111 1111 4111 8111 111111111111 및 후보 순번 1 및 분류 지정 문자열 및 시작 시각 500 자료 생성
    const candidateRow = {
        id: "11111111-1111-4111-8111-111111111111",
        candidate_index: 1,
        category: "OTHER",
        start_ms: 500,
        end_ms: 1500,
        anchor_ms: 1000,
        signal_score: 0.5,
        camera_sufficiency: "MEDIUM",
        reasons: [],
        broadcast_cue: broadcastCue
    };
    // 근거 행 시험 입력으로 식별자 22222222 2222 4222 8222 222222222222 및 후보 순번 1 및 종류 영상조각 및 시작 시각 500 자료 생성
    const evidenceRow = {
        id: "22222222-2222-4222-8222-222222222222",
        candidate_index: 1,
        kind: "CLIP",
        start_ms: 500,
        end_ms: 1500
    };

    // 검증용 상태 구성
    async function status(
        options: {
            source?: string;
            pipeline?: string | null;
            candidates?: unknown[];
            evidence?: unknown[];
        } = {}
    ) {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [
            [
                {
                    video_asset_id: "33333333-3333-4333-8333-333333333333",
                    video_status: "VALID",
                    validation_error_code: null,
                    analysis_id: "44444444-4444-4444-8444-444444444444",
                    analysis_status: "COMPLETED",
                    pipeline_version:
                        options.pipeline === undefined ? "video-baseline-v1" : options.pipeline,
                    source_sha256: options.source ?? SOURCE_SHA256,
                    stage: "SUCCEEDED",
                    progress_percent: 100,
                    failure_code: null,
                    limitations: []
                }
            ],
            options.candidates ?? [candidateRow],
            options.evidence ?? [evidenceRow]
        ];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: {
                execute: async (statement: SQL) => {
                    // 질의목록 추가 결과 처리 수행
                    queries.push(new PgDialect().sqlToQuery(statement));
                    // 대기열 선두꺼내기 결과 비교 조건 반환
                    return queue.shift() ?? [];
                }
            }
        } as never);
        // 저장소 상태 결과를 화면자료에 저장
        const view = await repository.status({
            anonymousSessionId: randomUUID(),
            videoAssetId: randomUUID(),
            now: NOW
        });
        // 화면자료 및 질의목록 자료 반환
        return { view: view?.analysis, queries };
    }

    it("computes competition scope from a stored source hash and covering clip without a judgment", async () => {
        // 상태 결과를 화면자료 질의목록에 저장
        const { view, queries } = await status();
        // 영상 원본 결과의 대회 지정 문자열 및 시즌 2026 자료의 필드 일치 확인
        expect(knownVideoSource(SOURCE_SHA256)).toMatchObject({
            competition: "K리그2",
            season: "2026"
        });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(view).toMatchObject({
            judgmentStatus: "NOT_EVALUATED",
            evaluatedCount: 0,
            diagnostics: { rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1 },
            candidates: [
                {
                    broadcastCue,
                    facts: null,
                    judgment: null,
                    varScopeEvaluation: {
                        kind: "COMPETITION_VAR_SCOPE",
                        status: "COMPLETED",
                        topic: "GOAL_RELATED",
                        included: true,
                        competition: "K리그2",
                        season: "2026",
                        evidenceIds: [evidenceRow.id],
                        citations: expect.arrayContaining([
                            expect.objectContaining({
                                authority: "KLEAGUE",
                                law: "25",
                                edition: "2026"
                            })
                        ])
                    }
                }
            ]
        });
        // 화면자료 후보목록 중 선택 항목 근거의 1개 항목 목록 기준 구조 일치 확인
        expect(view?.candidates[0]?.evidence).toEqual([
            { evidenceId: evidenceRow.id, kind: "CLIP" }
        ]);
        // 질의목록 중 선택 항목 질의의 영상 내용 해시 원본 해시 포함 확인
        expect(queries[0]?.sql).toContain("encode(video.content_sha256, 'hex') as source_sha256");
        // 질의목록 중 선택 항목 질의의 후보 방송 단서 포함 확인
        expect(queries[1]?.sql).toContain("candidate.broadcast_cue");
        // 질의목록 중 선택 항목 질의의 자산 시작 시각 자산 종료 시각 포함 확인
        expect(queries[2]?.sql).toContain("asset.start_ms, asset.end_ms");
    });

    it.each([
        { source: "ab".repeat(32) },
        { evidence: [] },
        { evidence: [{ ...evidenceRow, kind: "FRAME" }] },
        { evidence: [{ ...evidenceRow, candidate_index: 2 }] },
        { evidence: [{ ...evidenceRow, start_ms: 601 }] },
        { evidence: [{ ...evidenceRow, end_ms: 1399 }] }
    ])(
        "retains recognition but does not complete scope without verified source and covering clip: %j",
        async (options) => {
            // 상태 결과를 화면자료에 저장
            const { view } = await status(options);
            // 화면자료 후보목록의 항목 수 1 확인
            expect(view?.candidates).toHaveLength(1);
            // 화면자료 후보목록 중 선택 항목의 방송 단서 및 비디오판독범위평가 빈 값 및 판정 빈 값 자료의 필드 일치 확인
            expect(view?.candidates[0]).toMatchObject({
                broadcastCue,
                varScopeEvaluation: null,
                judgment: null
            });
            // 화면자료 진단의 원시 후보 개수 0 및 무효 출력 개수 0 및 인식완료 사건 개수 1 자료의 필드 일치 확인
            expect(view?.diagnostics).toMatchObject({
                rawProposalCount: 0,
                invalidOutputCount: 0,
                recognizedEventCount: 1
            });
        }
    );

    it("counts each technical exclusion once without granting it broadcast scope", async () => {
        // 상태 결과를 화면자료에 저장
        const { view } = await status({
            candidates: [
                candidateRow,
                { ...candidateRow, candidate_index: 2, broadcast_cue: null },
                { ...candidateRow, candidate_index: 3, start_ms: -1 }
            ]
        });
        // 화면자료 후보목록의 항목 수 1 확인
        expect(view?.candidates).toHaveLength(1);
        // 화면자료 진단의 원시 후보 개수 1 및 무효 출력 개수 1 및 인식완료 사건 개수 1 자료의 필드 일치 확인
        expect(view?.diagnostics).toMatchObject({
            rawProposalCount: 1,
            invalidOutputCount: 1,
            recognizedEventCount: 1
        });
    });

    it("counts a candidate with both corner and broadcast evidence as one recognized scene", async () => {
        // 상태 결과를 화면자료에 저장
        const { view } = await status({
            candidates: [
                {
                    ...candidateRow,
                    scene_event: {
                        kind: "CORNER_KICK",
                        status: "OBSERVED",
                        method: "corner-geometry-motion-v1",
                        startMs: 600,
                        endMs: 1400,
                        restartMs: 1000,
                        evidenceTimestampsMs: [600, 900, 1100, 1400]
                    }
                }
            ]
        });
        // 화면자료 후보목록의 항목 수 1 확인
        expect(view?.candidates).toHaveLength(1);
        // 화면자료 진단의 원시 후보 개수 0 및 무효 출력 개수 0 및 인식완료 사건 개수 1 자료의 필드 일치 확인
        expect(view?.diagnostics).toMatchObject({
            rawProposalCount: 0,
            invalidOutputCount: 0,
            recognizedEventCount: 1
        });
    });

    it.each(["USER", "MODEL"])(
        "does not substitute %s facts for a missing verified video source",
        async (factSource) => {
            // 상태 결과를 화면자료에 저장
            const { view } = await status({
                source: "",
                candidates: [
                    {
                        ...candidateRow,
                        fact_revision_id: randomUUID(),
                        fact_source: factSource,
                        fact_snapshot: judgment.facts
                    }
                ]
            });
            // 화면자료 후보목록의 항목 수 1 확인
            expect(view?.candidates).toHaveLength(1);
            // 화면자료 후보목록 중 선택 항목의 방송 단서 및 비디오판독범위평가 빈 값 및 판정 빈 값 자료의 필드 일치 확인
            expect(view?.candidates[0]).toMatchObject({
                broadcastCue,
                varScopeEvaluation: null,
                judgment: null
            });
        }
    );

    it("does not grant independent scope to legacy pipeline-null history", async () => {
        // 상태 결과를 화면자료에 저장
        const { view } = await status({ pipeline: null });
        // 화면자료의 진단 항목 없음 확인
        expect(view).not.toHaveProperty("diagnostics");
        // 화면자료 후보목록의 항목 수 1 확인
        expect(view?.candidates).toHaveLength(1);
        // 화면자료 후보목록 중 선택 항목의 방송 단서 및 비디오판독범위평가 빈 값 자료의 필드 일치 확인
        expect(view?.candidates[0]).toMatchObject({ broadcastCue, varScopeEvaluation: null });
    });

    it("reads older null broadcast columns without changing legacy candidate visibility", async () => {
        // 상태 결과를 화면자료에 저장
        const { view } = await status({
            pipeline: null,
            candidates: [{ ...candidateRow, broadcast_cue: null }]
        });
        // 화면자료 후보목록의 항목 수 1 확인
        expect(view?.candidates).toHaveLength(1);
        // 화면자료 후보목록 중 선택 항목의 방송 단서 빈 값 및 비디오판독범위평가 빈 값 자료의 필드 일치 확인
        expect(view?.candidates[0]).toMatchObject({ broadcastCue: null, varScopeEvaluation: null });
    });

    it("stores broadcast JSON separately from review scenario, tracking, and judgments", async () => {
        // 작업 식별자 및 분석 식별자 시험용 무작위식별자 결과 준비
        const jobId = randomUUID(),
            analysisId = randomUUID();
        // 해시계산기 해시 결과를 토큰 해시에 저장
        const tokenHash = await hasher.sha256("test-lease");
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
                            // 입력 조건 반환
                            return queries.length === 1
                                ? [
                                      {
                                          id: jobId,
                                          status: "PROCESSING",
                                          job_type: "ANALYZE_VIDEO",
                                          job_revision: 1,
                                          attempt: 1,
                                          lease_owner: "test-worker",
                                          lease_token_hash: Buffer.from(tokenHash),
                                          lease_until: EXPIRES,
                                          analysis_id: analysisId
                                      }
                                  ]
                                : [];
                        }
                    })
            }
        } as never);
        // 전송자료 시험 입력으로 기존 항목 및 근거 자료 생성
        const payload = { ...synthetic(analysisId, jobId), evidence: [] };
        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            repository.result({
                jobId,
                workerId: "test-worker",
                jobRevision: 1,
                leaseTokenHash: tokenHash,
                now: NOW,
                payload
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 삽입 시험용 질의목록 조회 결과 준비
        const insert = queries.find((query) =>
            query.sql.includes("insert into incident_candidates")
        );
        // 삽입 질의의 방송 단서 포함 확인
        expect(insert?.sql).toContain("broadcast_cue");
        // 삽입 인자목록의 응답본문 직렬화 결과 포함 확인
        expect(insert?.params).toContain(JSON.stringify(broadcastCue));
        // 삽입 인자목록의 지정 문자열 포함 확인
        expect(insert?.params).toContain("OTHER");
        // 질의목록 일부충족 결과의 기대값 거짓 일치 확인
        expect(queries.some((query) => query.sql.includes("insert into decision_results"))).toBe(
            false
        );
    });
});

describe.skipIf(!databaseUrl)("Worker broadcast -> API -> PostgreSQL -> competition scope", () => {
    // 데이터베이스 주소 부정 조건에 따른 처리 경로 분기
    if (!databaseUrl) return;
    // 데이터베이스 시험용 클라이언트 결과 준비
    const database = client(databaseUrl);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];
    afterEach(async () => {
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const id of sessions.splice(0)) {
            // 분석 삭제
            await database.sql`delete from analyses where anonymous_session_id = ${id}`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where anonymous_session_id = ${id}`;
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${id}`;
        }
    });
    afterAll(async () => {
        // 데이터베이스 연결종료 결과 처리 수행
        await database.close();
    });

    // 검증용 준비 구성
    async function setup(sourceSha256 = "ab".repeat(32)) {
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID(),
            videoId = randomUUID(),
            analysisId = randomUUID(),
            jobId = randomUUID();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, ${NOW}, ${EXPIRES})`;
        // 영상 자산 삽입
        await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at, competition, season)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from(sourceSha256, "hex")}, 'video/mp4',
      100, 'VALID', ${NOW}, ${NOW}, ${EXPIRES}, 'UNKNOWN', 'UNKNOWN')`;
        // 분석 삽입
        await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
      pipeline_version, media_policy_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', 'video-baseline-v1', 'media-v1', ${NOW}, ${EXPIRES})`;
        // 영상 처리 작업 삽입
        await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
      attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
      values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'test-worker',
      ${Buffer.from(await hasher.sha256("test-lease"))}, ${EXPIRES}, ${NOW}, ${NOW})`;
        // 세션 식별자 및 분석 식별자 및 작업 식별자 자료 반환
        return { sessionId, analysisId, jobId };
    }

    // 검증용 전송 구성
    async function send(jobId: string, payload: AnalysisPayload) {
        // 작업 시험용 결과 준비
        const operation = result({
            clock: { now: () => new Date(NOW) },
            hasher,
            repository: new JobStore(database)
        });
        // 결과 결과 반환
        return acceptResult(
            new Request("http://local/internal/jobs/result", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "test-key",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "test-worker",
                    jobRevision: 1,
                    leaseToken: "test-lease",
                    payload
                })
            }),
            { jobId },
            { key: "test-key", result: operation } as JobApiDependencies
        );
    }

    // 검증용 내부 조회 구성
    async function readInternal(sessionId: string, analysisId: string) {
        // 상태 저장소 분석 결과 반환
        return new StatusStore(database).analysis({
            anonymousSessionId: sessionId,
            analysisId,
            now: NOW
        });
    }

    it.each(["ab".repeat(32), SOURCE_SHA256])(
        "persists cue and computes scope only for registered source %s",
        async (sourceSha256) => {
            // 시험환경 결과를 식별자목록에 저장
            const ids = await setup(sourceSha256);
            // 전송자료 시험용 합성자료 결과 준비
            const payload = synthetic(ids.analysisId, ids.jobId);
            // 전송 결과 상태의 기대값 200 일치 확인
            expect((await send(ids.jobId, payload)).status).toBe(200);
            // 인식 후보 사건 조회
            const stored =
                await database.sql`select broadcast_cue, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
            // 저장값의 1개 항목 목록 기준 구조 일치 확인
            expect(stored).toEqual([
                expect.objectContaining({
                    broadcast_cue: broadcastCue,
                    tracking: null,
                    scene_event: null
                })
            ]);
            // 읽기 내부 결과를 화면자료에 저장
            const view = await readInternal(ids.sessionId, ids.analysisId);
            // 화면자료 진단의 원시 후보 개수 0 및 무효 출력 개수 0 및 인식완료 사건 개수 1 자료의 필드 일치 확인
            expect(view?.diagnostics).toMatchObject({
                rawProposalCount: 0,
                invalidOutputCount: 0,
                recognizedEventCount: 1
            });
            // 화면자료 후보목록의 항목 수 1 확인
            expect(view?.candidates).toHaveLength(1);
            // 화면자료 후보목록 중 선택 항목의 방송 단서 및 판정 빈 값 및 사실 빈 값 자료의 필드 일치 확인
            expect(view?.candidates[0]).toMatchObject({
                broadcastCue,
                judgment: null,
                facts: null
            });
            // 원본 해시 비교 조건에 따른 처리 경로 분기
            if (sourceSha256 === SOURCE_SHA256) {
                // 화면자료 후보목록 중 선택 항목 비디오판독범위평가의 상태 완료 및 주제 득점관련 및 지정 항목 참 및 대회 지정 문자열 자료의 필드 일치 확인
                expect(view?.candidates[0]?.varScopeEvaluation).toMatchObject({
                    status: "COMPLETED",
                    topic: "GOAL_RELATED",
                    included: true,
                    competition: "K리그2",
                    season: "2026",
                    citations: expect.arrayContaining([
                        expect.objectContaining({
                            authority: "KLEAGUE",
                            law: "25",
                            edition: "2026"
                        })
                    ])
                });
            } else expect(view?.candidates[0]?.varScopeEvaluation).toBeNull();
            // 판정 결과 조회 결과의 행 수가 0개임 확인
            expect(
                await database.sql`select id from decision_results where analysis_id = ${ids.analysisId}`
            ).toHaveLength(0);
            // 읽기 내부 결과의 빈 값 확인
            expect(await readInternal(randomUUID(), ids.analysisId)).toBeNull();
        }
    );

    it("rejects an out-of-candidate broadcast cue before any output is written", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup(SOURCE_SHA256);
        // 기준자료 시험용 합성자료 결과 준비
        const baseline = synthetic(ids.analysisId, ids.jobId);
        // 전송자료 시험 입력으로 기존 항목 및 후보목록 자료 생성
        const payload = {
            ...baseline,
            candidates: [
                { ...baseline.candidates[0]!, broadcastCue: { ...broadcastCue, endMs: 1501 } }
            ]
        };
        // 전송 결과 상태의 기대값 400 일치 확인
        expect((await send(ids.jobId, payload)).status).toBe(400);
        // 사건 후보 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`
        ).toHaveLength(0);
        // 영상 샷 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from shots where analysis_id = ${ids.analysisId}`
        ).toHaveLength(0);
    });

    it("retains legacy null-column reads without manufacturing scope", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup(SOURCE_SHA256);
        // 기준자료 시험용 합성자료 결과 준비
        const baseline = synthetic(ids.analysisId, ids.jobId);
        // 전송 결과 상태의 기대값 200 일치 확인
        expect(
            (
                await send(ids.jobId, {
                    ...baseline,
                    candidates: [{ ...baseline.candidates[0]!, broadcastCue: null }]
                })
            ).status
        ).toBe(200);
        // 분석 갱신
        await database.sql`update analyses set pipeline_version = null where id = ${ids.analysisId}`;
        // 읽기 내부 결과를 화면자료에 저장
        const view = await readInternal(ids.sessionId, ids.analysisId);
        // 화면자료의 진단 항목 없음 확인
        expect(view).not.toHaveProperty("diagnostics");
        // 화면자료 후보목록의 항목 수 1 확인
        expect(view?.candidates).toHaveLength(1);
        // 화면자료 후보목록 중 선택 항목의 방송 단서 빈 값 및 비디오판독범위평가 빈 값 및 판정 빈 값 자료의 필드 일치 확인
        expect(view?.candidates[0]).toMatchObject({
            broadcastCue: null,
            varScopeEvaluation: null,
            judgment: null
        });
    });

    it.skipIf(!process.env.REPLAY_BROADCAST_REPORT)(
        "runs actual Python broadcast evidence through API, storage, and scope",
        async () => {
            // 보고서 시험용 경로해결 결과 준비
            const reportPath = resolve(process.env.REPLAY_BROADCAST_REPORT!);
            // 맥락 시험용 응답본문 해석 결과 준비
            const context = JSON.parse(
                readFileSync(resolve(dirname(reportPath), "tracking/context-summary.json"), "utf-8")
            ) as { source_sha256: string };
            // 영상 원본 결과의 값 존재 확인
            expect(knownVideoSource(context.source_sha256)).not.toBeNull();
            // 시험환경 결과를 식별자목록에 저장
            const ids = await setup(context.source_sha256);
            // 코드 시험용 지정 형식 문자열 준비
            const code = `import json,sys
from pathlib import Path
from replay_video.runner import report
class LocalStorage:
    def evidence(self,item,entries):
        return {"kind":"GRANTED","items":[{"name":e["name"],"objectKey":f"evidence/{sys.argv[2]}/{sys.argv[3]}/{e['name']}","uploadUrl":"local"} for e in entries]}
    def put(self,url,source,content_type):
        assert source.is_file() and source.stat().st_size > 0
print(json.dumps(report(LocalStorage(),{},Path(sys.argv[1]))))`;
            // 전송자료 시험용 응답본문 해석 결과 준비
            const payload = JSON.parse(
                execFileSync(python(), ["-c", code, reportPath, ids.analysisId, ids.jobId], {
                    env: { ...process.env, PYTHONPATH: resolve("apps/video-worker/src") },
                    encoding: "utf-8",
                    maxBuffer: 4 * 1024 * 1024
                })
            ) as AnalysisPayload;
            // 단서목록 시험용 전송자료 후보목록 필터 결과 준비
            const cues = payload.candidates.filter((candidate) =>
                broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs)
            );
            // 단서목록 길이의 0 초과 확인
            expect(cues.length).toBeGreaterThan(0);
            // 단서목록의 각 사례 순회
            for (const candidate of cues) {
                // 전송자료 근거 일부충족 결과의 기대값 참 일치 확인
                expect(
                    payload.evidence?.some(
                        (asset) =>
                            asset.candidateIndex === candidate.index &&
                            asset.kind === "CLIP" &&
                            asset.startMs <= candidate.broadcastCue!.startMs &&
                            asset.endMs >= candidate.broadcastCue!.endMs
                    )
                ).toBe(true);
            }
            // 전송 결과 상태의 기대값 200 일치 확인
            expect((await send(ids.jobId, payload)).status).toBe(200);
            // 읽기 내부 결과를 화면자료에 저장
            const view = await readInternal(ids.sessionId, ids.analysisId);
            // 인식완료 시험용 전송자료 후보목록 필터 결과 준비
            const recognized = payload.candidates.filter(
                (candidate) =>
                    broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs) ||
                    sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)
            );
            // 화면자료 진단의 원시 후보 개수 및 무효 출력 개수 0 및 인식완료 사건 개수 자료의 필드 일치 확인
            expect(view?.diagnostics).toMatchObject({
                rawProposalCount: payload.candidates.length - recognized.length,
                invalidOutputCount: 0,
                recognizedEventCount: recognized.length
            });
            // 화면자료 후보목록 필터 결과의 항목 수 단서목록 길이 확인
            expect(
                view?.candidates.filter(
                    (candidate) => candidate.varScopeEvaluation?.status === "COMPLETED"
                )
            ).toHaveLength(cues.length);
            // 화면자료 후보목록 전체충족 결과의 기대값 참 일치 확인
            expect(view?.candidates.every((candidate) => candidate.judgment === null)).toBe(true);
            // 인식 후보 사건 조회
            const stored =
                await database.sql`select candidate_index, broadcast_cue, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
            // 저장값의 항목 수 전송자료 후보목록 길이 확인
            expect(stored).toHaveLength(payload.candidates.length);
            // 전송자료 후보목록의 각 사례 순회
            for (const input of payload.candidates) {
                // 행 시험용 저장값 조회 결과 준비
                const row = stored.find((item) => item.candidate_index === input.index);
                // 행 방송 단서의 입력 방송 단서 비교 조건 기준 구조 일치 확인
                expect(row?.broadcast_cue).toEqual(input.broadcastCue ?? null);
                // 행 추적의 입력 추적 비교 조건 기준 구조 일치 확인
                expect(row?.tracking).toEqual(input.tracking ?? null);
                // 행 장면 사건의 입력 장면 사건 비교 조건 기준 구조 일치 확인
                expect(row?.scene_event).toEqual(input.sceneEvent ?? null);
            }
            // 판정 결과 조회 결과의 행 수가 0개임 확인
            expect(
                await database.sql`select id from decision_results where analysis_id = ${ids.analysisId}`
            ).toHaveLength(0);
            // 보고서 결과를 공개화면에 저장
            const publicView = await report({
                clock: { now: () => new Date(NOW) },
                repository: new StatusStore(database)
            })({
                anonymousSessionId: ids.sessionId,
                analysisId: ids.analysisId
            });
            // 공개화면의 값 존재 확인
            expect(publicView).not.toBeNull();
            // 공개화면 부정 조건 비교 조건에 따른 처리 경로 분기
            if (!publicView || "kind" in publicView)
                // 오류객체 예외 전달
                throw new Error("public-broadcast-analysis-not-returned");
            // 미평가 조건을 포함한 기대 결과 일치 확인
            expect(publicView).toMatchObject({
                resultPolicy: "COMPLETED_ONLY",
                status: "COMPLETED",
                judgmentStatus: "NOT_EVALUATED",
                evaluatedCount: 0,
                completedScopeCount: cues.length
            });
            // 공개화면의 진단 항목 없음 확인
            expect(publicView).not.toHaveProperty("diagnostics");
            // 공개화면의 필터 요약 항목 없음 확인
            expect(publicView).not.toHaveProperty("filterSummary");
            // 공개화면 후보목록의 항목 수 단서목록 길이 확인
            expect(publicView.candidates).toHaveLength(cues.length);
            // 공개화면 후보목록 항목변환 결과의 1개 항목 목록 정렬 결과 항목변환 결과 기준 구조 일치 확인
            expect(publicView.candidates.map((candidate) => candidate.index)).toEqual(
                [...cues]
                    .sort(
                        (first, second) =>
                            first.startMs - second.startMs || first.index - second.index
                    )
                    .map((candidate) => candidate.index)
            );
            // 공개화면 후보목록의 각 사례 순회
            for (const candidate of publicView.candidates) {
                // 후보 판정의 빈 값 확인
                expect(candidate.judgment).toBeNull();
                // 후보의 사실 항목 없음 확인
                expect(candidate).not.toHaveProperty("facts");
                // 후보의 관측 항목 없음 확인
                expect(candidate).not.toHaveProperty("observation");
                // 후보의 필터 항목 없음 확인
                expect(candidate).not.toHaveProperty("filter");
                // 후보의 장면 사건 항목 없음 확인
                expect(candidate).not.toHaveProperty("sceneEvent");
                // 후보 비디오판독범위평가의 종류 대회 비디오판독 적용범위 및 상태 완료 및 주제 득점관련 및 지정 항목 참 자료의 필드 일치 확인
                expect(candidate.varScopeEvaluation).toMatchObject({
                    kind: "COMPETITION_VAR_SCOPE",
                    status: "COMPLETED",
                    topic: "GOAL_RELATED",
                    included: true,
                    competition: "K리그2",
                    season: "2026",
                    ruleVersionId: "kleague2-2026",
                    provenance: {
                        sourceSha256: context.source_sha256,
                        origin: "VIDEO_CUE_AND_COMPETITION_RULES"
                    },
                    notAssessed: expect.arrayContaining([
                        "FOUL_DECISION",
                        "REFEREE_DECISION_CORRECTNESS",
                        "VAR_CHECK_PERFORMED"
                    ])
                });
                // 적용범위 시험용 후보 비디오판독범위평가 준비
                const scope = candidate.varScopeEvaluation!;
                // 적용범위 인용목록 길이의 0 초과 확인
                expect(scope.citations.length).toBeGreaterThan(0);
                // 적용범위 인용목록 전체충족 결과의 기대값 참 일치 확인
                expect(
                    scope.citations.every(
                        (citation) =>
                            citation.authority === "KLEAGUE" &&
                            citation.law === "25" &&
                            citation.edition === "2026" &&
                            citation.ruleId.startsWith("kleague2-2026-")
                    )
                ).toBe(true);
                // 적용범위 근거 식별자목록 길이의 0 초과 확인
                expect(scope.evidenceIds.length).toBeGreaterThan(0);
                // 적용범위 근거 식별자목록 전체충족 결과의 기대값 참 일치 확인
                expect(
                    scope.evidenceIds.every((id) =>
                        candidate.evidence?.some(
                            (asset) => asset.evidenceId === id && asset.kind === "CLIP"
                        )
                    )
                ).toBe(true);
            }
            // 실행환경 환경설정 재생 적용범위 출력에 따른 처리 경로 분기
            if (process.env.REPLAY_SCOPE_OUTPUT)
                // 쓰기 결과 처리 수행
                writeFileSync(
                    process.env.REPLAY_SCOPE_OUTPUT,
                    `${JSON.stringify(publicView, null, 2)}\n`,
                    "utf-8"
                );
        }
    );
});
