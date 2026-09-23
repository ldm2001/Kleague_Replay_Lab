import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { python } from "../../../../scripts/python.mjs";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { result, report, type AnalysisPayload } from "@replay/application";
import { sceneEventData, WORKER_PROTOCOL, type SceneEvent } from "@replay/shared-types";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 현재시각 시험용 2030 01 00 00 준비
const NOW = "2030-01-01T12:00:00.000Z";
// 만료시각 시험용 2030 01 00 00 준비
const EXPIRES = "2030-01-02T12:00:00.000Z";
// 해시계산기 시험 입력으로 해시 자료 생성
const hasher = {
    sha256: async (value: string) => new Uint8Array(createHash("sha256").update(value).digest())
};
// 코너킥 사건 시험 입력으로 종류 코너킥 및 상태 관측완료 및 시작시각 600 및 종료시각 1400 자료 생성
const cornerEvent: SceneEvent = {
    kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
    evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};

describe.skipIf(!databaseUrl)("Worker tracking -> API -> PostgreSQL -> rules", () => {
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
    async function setup() {
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
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from(randomUUID())}, 'video/mp4',
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
                    tracking: {
                        version: "ball-path-v1",
                        // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
                        coverage: "COMPLETE",
                        sampleCount: 20,
                        selectedCount: 18,
                        cameraCount: 16,
                        motionOnsetsMs: [1200]
                    }
                }
            ],
            evidence: [
                {
                    candidateIndex: 1,
                    kind: "FRAME",
                    objectKey: `evidence/${analysisId}/${jobId}/frame.jpg`,
                    contentSha256: "ab".repeat(32),
                    startMs: 500,
                    endMs: 1500,
                    width: 640,
                    height: 360
                }
            ]
        };
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

    // 검증용 공개 조회 구성
    async function readPublic(sessionId: string, analysisId: string) {
        // 보고서 결과 반환
        return report({
            clock: { now: () => new Date(NOW) },
            repository: new StatusStore(database)
        })({ anonymousSessionId: sessionId, analysisId });
    }

    // 검증용 완료 결과 제한 확인 구성
    function expectCompletedOnly(view: Awaited<ReturnType<typeof readPublic>>) {
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(view).toMatchObject({
            status: "COMPLETED",
            resultPolicy: "COMPLETED_ONLY",
            mode: "VISUAL_CHANGE_BASELINE",
            judgmentStatus: "NOT_EVALUATED",
            evaluatedCount: 0,
            candidates: []
        });
        // 화면자료의 진단 항목 없음 확인
        expect(view).not.toHaveProperty("diagnostics");
        // 화면자료의 필터 요약 항목 없음 확인
        expect(view).not.toHaveProperty("filterSummary");
    }

    it("persists raw proposal tracking without presenting it as a recognized scene", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 전송자료 시험용 합성자료 결과 준비
        const payload = synthetic(ids.analysisId, ids.jobId);
        // 전송 결과 상태의 기대값 200 일치 확인
        expect((await send(ids.jobId, payload)).status).toBe(200);
        // 읽기 내부 결과를 화면자료에 저장
        const view = await readInternal(ids.sessionId, ids.analysisId);
        // 인식 후보 사건 조회
        const stored =
            await database.sql`select tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
        // 저장값의 항목 수 1 확인
        expect(stored).toHaveLength(1);
        // 저장값 중 선택 항목의 추적 및 장면 사건 빈 값 자료의 필드 일치 확인
        expect(stored[0]).toMatchObject({
            tracking: payload.candidates[0]!.tracking,
            scene_event: null
        });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(view).toMatchObject({
            status: "COMPLETED",
            judgmentStatus: "NOT_EVALUATED",
            candidates: [],
            filterSummary: {
                checkedCount: 1,
                observedCount: 0,
                applicableCount: 0,
                excludedCount: 0,
                undeterminedCount: 1
            },
            diagnostics: {
                rawProposalCount: 1,
                invalidOutputCount: 0,
                recognizedEventCount: 0,
                supportedEventTypes: ["CORNER_KICK"],
                reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR", "UNRECOGNIZED_PROPOSALS"])
            }
        });
        // 완료 결과 처리 수행
        expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
        // 읽기 내부 결과의 화면자료 기준 구조 일치 확인
        expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(view);
        // 읽기 내부 결과의 빈 값 확인
        expect(await readInternal(randomUUID(), ids.analysisId)).toBeNull();
        // 읽기 공개 결과의 빈 값 확인
        expect(await readPublic(randomUUID(), ids.analysisId)).toBeNull();
    });

    it("rejects out-of-scene tracking before any candidate is stored", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 전송자료 시험용 합성자료 결과 준비
        const payload = synthetic(ids.analysisId, ids.jobId);
        // 후보 시험용 전송자료 후보목록 중 선택 항목 준비
        const candidate = payload.candidates[0]!;
        // 전송 결과를 응답에 저장
        const response = await send(ids.jobId, {
            ...payload,
            candidates: [
                { ...candidate, tracking: { ...candidate.tracking!, motionOnsetsMs: [1501] } }
            ]
        });
        // 응답 상태의 기대값 400 일치 확인
        expect(response.status).toBe(400);
        // 사건 후보 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`
        ).toHaveLength(0);
    });

    it("persists a corner observation and returns reference conditions when match rules are unknown", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 기준자료 시험용 합성자료 결과 준비
        const baseline = synthetic(ids.analysisId, ids.jobId);
        // 전송자료 시험 입력으로 기존 항목 및 후보목록 자료 생성
        const payload = {
            ...baseline,
            candidates: [{ ...baseline.candidates[0]!, sceneEvent: cornerEvent }]
        };
        // 전송 결과 상태의 기대값 200 일치 확인
        expect((await send(ids.jobId, payload)).status).toBe(200);
        // 인식 후보 사건 조회
        const [stored] =
            await database.sql`select scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
        // 저장값 장면 사건의 코너킥 사건 기준 구조 일치 확인
        expect(stored?.scene_event).toEqual(cornerEvent);
        // 읽기 내부 결과를 내부 화면자료에 저장
        const internalView = await readInternal(ids.sessionId, ids.analysisId);
        // 미평가 및 규정 맥락 미검증 및 미검증 조건을 포함한 기대 결과 일치 확인
        expect(internalView).toMatchObject({
            status: "COMPLETED",
            judgmentStatus: "NOT_EVALUATED",
            rule: null,
            filterSummary: {
                checkedCount: 1,
                observedCount: 1,
                applicableCount: 0,
                excludedCount: 0,
                undeterminedCount: 0
            },
            candidates: [
                {
                    sceneEvent: cornerEvent,
                    judgment: null,
                    filter: {
                        status: "OBSERVED",
                        situation: "CORNER_KICK",
                        referenceOnly: true,
                        ruleReferences: [],
                        reasonCodes: expect.arrayContaining([
                            "SITUATION_OBSERVED",
                            "RULE_CONTEXT_UNVERIFIED"
                        ]),
                        conditions: expect.arrayContaining([
                            expect.objectContaining({
                                code: "CORNER_RESTART",
                                status: "UNVERIFIED"
                            })
                        ])
                    }
                }
            ]
        });
        // 완료 결과 처리 수행
        expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
        // 읽기 내부 결과의 내부 화면자료 기준 구조 일치 확인
        expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(internalView);
    });

    it("rejects an event outside its candidate before storing any pipeline output", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 전송자료 시험용 합성자료 결과 준비
        const payload = synthetic(ids.analysisId, ids.jobId);
        // 전송 결과를 응답에 저장
        const response = await send(ids.jobId, {
            ...payload,
            candidates: [{ ...payload.candidates[0]!, sceneEvent: { ...cornerEvent, endMs: 1501 } }]
        });
        // 응답 상태의 기대값 400 일치 확인
        expect(response.status).toBe(400);
        // 사건 후보 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`
        ).toHaveLength(0);
        // 영상 샷 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from shots where analysis_id = ${ids.analysisId}`
        ).toHaveLength(0);
    });

    it("keeps a valid scene observation internally when rules are undetermined", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 기준자료 시험용 합성자료 결과 준비
        const baseline = synthetic(ids.analysisId, ids.jobId);
        // 전송자료 시험 입력으로 기존 항목 및 후보목록 및 근거 자료 생성
        const payload = {
            ...baseline,
            candidates: [{ ...baseline.candidates[0]!, sceneEvent: cornerEvent }],
            evidence: []
        };
        // 전송 결과 상태의 기대값 200 일치 확인
        expect((await send(ids.jobId, payload)).status).toBe(200);
        // 읽기 내부 결과를 내부 화면자료에 저장
        const internalView = await readInternal(ids.sessionId, ids.analysisId);
        // 근거 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(internalView).toMatchObject({
            judgmentStatus: "NOT_EVALUATED",
            rule: null,
            filterSummary: {
                checkedCount: 1,
                observedCount: 0,
                applicableCount: 0,
                excludedCount: 0,
                undeterminedCount: 1
            },
            diagnostics: {
                rawProposalCount: 0,
                invalidOutputCount: 0,
                recognizedEventCount: 1,
                supportedEventTypes: ["CORNER_KICK"]
            },
            candidates: [
                {
                    sceneEvent: cornerEvent,
                    facts: null,
                    judgment: null,
                    evidence: [],
                    filter: {
                        status: "UNDETERMINED",
                        reasonCodes: expect.arrayContaining([
                            "EVIDENCE_UNAVAILABLE",
                            "RULE_CONTEXT_UNVERIFIED"
                        ])
                    }
                }
            ]
        });
        // 완료 결과 처리 수행
        expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
        // 읽기 내부 결과의 내부 화면자료 기준 구조 일치 확인
        expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(internalView);
    });

    it("reads older pipeline results with missing tracking", async () => {
        // 시험환경 결과를 식별자목록에 저장
        const ids = await setup();
        // 전송자료 시험용 합성자료 결과 준비
        const payload = synthetic(ids.analysisId, ids.jobId);
        // 전송 결과 상태의 기대값 200 일치 확인
        expect(
            (
                await send(ids.jobId, {
                    ...payload,
                    candidates: [
                        { ...payload.candidates[0]!, tracking: null, sceneEvent: cornerEvent }
                    ]
                })
            ).status
        ).toBe(200);
        // 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(await readInternal(ids.sessionId, ids.analysisId)).toMatchObject({
            candidates: [
                {
                    tracking: null,
                    sceneEvent: cornerEvent,
                    filter: { trackingStatus: "UNAVAILABLE" }
                }
            ]
        });
        // 완료 결과 처리 수행
        expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
        // 분석 갱신
        await database.sql`update analyses set pipeline_version = null where id = ${ids.analysisId}`;
        // 읽기 공개 결과를 기존형식 화면자료에 저장
        const legacyView = await readPublic(ids.sessionId, ids.analysisId);
        // 기존형식 화면자료의 읽기 내부 결과 기준 구조 일치 확인
        expect(legacyView).toEqual(await readInternal(ids.sessionId, ids.analysisId));
        // 기존형식 화면자료의 결과정책 항목 없음 확인
        expect(legacyView).not.toHaveProperty("resultPolicy");
        // 기존형식 화면자료의 진단 항목 없음 확인
        expect(legacyView).not.toHaveProperty("diagnostics");
        // 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(legacyView).toMatchObject({
            filterSummary: { checkedCount: 1, observedCount: 1 },
            candidates: [
                {
                    tracking: null,
                    sceneEvent: cornerEvent,
                    filter: { trackingStatus: "UNAVAILABLE" }
                }
            ]
        });
    });

    it.skipIf(!process.env.REPLAY_PIPELINE_REPORT)(
        "runs the actual Python report through the same API and rules path",
        async () => {
            // 시험환경 결과를 식별자목록에 저장
            const ids = await setup();
            // 실제 작업 실행기 변환기를 사용하고 저장소 업로드만 로컬 파일 존재 검사로 대체
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
                execFileSync(
                    python(),
                    ["-c", code, process.env.REPLAY_PIPELINE_REPORT!, ids.analysisId, ids.jobId],
                    {
                        env: { ...process.env, PYTHONPATH: resolve("apps/video-worker/src") },
                        encoding: "utf-8",
                        maxBuffer: 4 * 1024 * 1024
                    }
                )
            ) as AnalysisPayload;
            // 전송자료 후보목록 길이의 0 초과 확인
            expect(payload.candidates.length).toBeGreaterThan(0);
            // 관측결과 시험용 전송자료 후보목록 필터 결과 준비
            const observed = payload.candidates.filter((candidate) =>
                sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)
            );
            // 원시 후보 개수 시험용 전송자료 후보목록 길이 비교 조건 준비
            const rawProposalCount = payload.candidates.length - observed.length;
            // 관측결과 길이의 0 초과 확인
            expect(observed.length).toBeGreaterThan(0);
            // 관측결과의 각 사례 순회
            for (const candidate of observed) {
                // 장면 사건 자료 결과의 기대값 참 일치 확인
                expect(
                    sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)
                ).toBe(true);
                // 전송자료 근거 일부충족 결과의 기대값 참 일치 확인
                expect(
                    payload.evidence?.some(
                        (asset) => asset.candidateIndex === candidate.index && asset.kind === "CLIP"
                    )
                ).toBe(true);
            }
            // 전송 결과를 응답에 저장
            const response = await send(ids.jobId, payload);
            // 응답 상태의 기대값 200 일치 확인
            expect(response.status).toBe(200);
            // 응답 응답본문 결과의 종류 접수완료 자료 기준 구조 일치 확인
            expect(await response.json()).toEqual({ kind: "ACCEPTED" });
            // 읽기 내부 결과를 화면자료에 저장
            const view = await readInternal(ids.sessionId, ids.analysisId);
            // 화면자료의 값 존재 확인
            expect(view).not.toBeNull();
            // 화면자료 부정 조건에 따른 처리 경로 분기
            if (!view) throw new Error("internal-analysis-not-returned");
            // 화면자료 필터 요약 확인완료 개수의 기대값 전송자료 후보목록 길이 일치 확인
            expect(view.filterSummary?.checkedCount).toBe(payload.candidates.length);
            // 화면자료 필터 요약 제외 개수의 기대값 0 일치 확인
            expect(view.filterSummary?.excludedCount).toBe(0);
            // 화면자료 필터 요약 관측결과 개수의 기대값 관측결과 길이 일치 확인
            expect(view.filterSummary?.observedCount).toBe(observed.length);
            // 화면자료 필터 요약 적용가능 개수의 기대값 0 일치 확인
            expect(view.filterSummary?.applicableCount).toBe(0);
            // 화면자료 필터 요약 미확정 개수의 기대값 원시 후보 개수 일치 확인
            expect(view.filterSummary?.undeterminedCount).toBe(rawProposalCount);
            // 미평가 조건을 포함한 기대 결과 일치 확인
            expect(view).toMatchObject({
                judgmentStatus: "NOT_EVALUATED",
                rule: null,
                diagnostics: {
                    rawProposalCount,
                    invalidOutputCount: 0,
                    recognizedEventCount: observed.length,
                    supportedEventTypes: ["CORNER_KICK"],
                    reasons: expect.arrayContaining([
                        "CORNER_ONLY_DETECTOR",
                        ...(rawProposalCount > 0 ? ["UNRECOGNIZED_PROPOSALS"] : [])
                    ])
                }
            });
            // 읽기 공개 결과를 공개화면에 저장
            const publicView = await readPublic(ids.sessionId, ids.analysisId);
            // 완료 결과 처리 수행
            expectCompletedOnly(publicView);
            // 공개화면 부정 조건 비교 조건에 따른 처리 경로 분기
            if (!publicView || "kind" in publicView)
                // 오류객체 예외 전달
                throw new Error("public-analysis-not-returned");
            // 공개화면 규정의 빈 값 확인
            expect(publicView.rule).toBeNull();
            // 공개화면 후보목록 필터 결과의 항목 수 0 확인
            expect(
                publicView.candidates.filter((candidate) => candidate.judgment != null)
            ).toHaveLength(0);
            // 읽기 내부 결과의 화면자료 기준 구조 일치 확인
            expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(view);
            // 인식 후보 사건 조회
            const stored =
                await database.sql`select candidate_index, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
            // 저장값의 항목 수 전송자료 후보목록 길이 확인
            expect(stored).toHaveLength(payload.candidates.length);
            // 전송자료 후보목록의 각 사례 순회
            for (const input of payload.candidates) {
                // 행 시험용 저장값 조회 결과 준비
                const row = stored.find((item) => item.candidate_index === input.index);
                // 행의 정의된 값 확인
                expect(row).toBeDefined();
                // 행 추적의 입력 추적 비교 조건 기준 구조 일치 확인
                expect(row?.tracking).toEqual(input.tracking ?? null);
                // 행 장면 사건의 입력 장면 사건 비교 조건 기준 구조 일치 확인
                expect(row?.scene_event).toEqual(input.sceneEvent ?? null);
            }
            // 화면자료 후보목록의 항목 수 관측결과 길이 확인
            expect(view.candidates).toHaveLength(observed.length);
            // 화면자료 후보목록 항목변환 결과 정렬 결과의 관측결과 항목변환 결과 정렬 결과 기준 구조 일치 확인
            expect(
                view.candidates.map((candidate) => candidate.index).sort((a, b) => a - b)
            ).toEqual(observed.map((candidate) => candidate.index).sort((a, b) => a - b));
            // 화면자료 후보목록의 각 사례 순회
            for (const candidate of view.candidates) {
                // 입력 시험용 전송자료 후보목록 조회 결과 준비
                const input = payload.candidates.find((item) => item.index === candidate.index)!;
                // 후보 추적의 입력 추적 비교 조건 기준 구조 일치 확인
                expect(candidate.tracking).toEqual(input.tracking ?? null);
                // 후보 장면 사건의 입력 장면 사건 기준 구조 일치 확인
                expect(candidate.sceneEvent).toEqual(input.sceneEvent);
                // 장면 사건 자료 결과의 기대값 참 일치 확인
                expect(
                    sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)
                ).toBe(true);
                // 후보 필터 상태의 기대값 제외 불일치 확인
                expect(candidate.filter?.status).not.toBe("EXCLUDED");
                // 규정 맥락 미검증 조건을 포함한 기대 결과 일치 확인
                expect(candidate.filter).toMatchObject({
                    status: "OBSERVED",
                    situation: "CORNER_KICK",
                    referenceOnly: true,
                    ruleReferences: [],
                    reasonCodes: expect.arrayContaining([
                        "SITUATION_OBSERVED",
                        "RULE_CONTEXT_UNVERIFIED"
                    ])
                });
                // 후보 필터 조건목록 길이의 0 초과 확인
                expect(candidate.filter?.conditions?.length).toBeGreaterThan(0);
                // 각 규정 조건이 모두 미검증 상태로 보존됨 확인
                expect(
                    candidate.filter?.conditions?.every(
                        (condition) => condition.status === "UNVERIFIED"
                    )
                ).toBe(true);
                // 후보 근거 일부충족 결과의 기대값 참 일치 확인
                expect(candidate.evidence?.some((asset) => asset.kind === "CLIP")).toBe(true);
                // 후보 사실의 빈 값 확인
                expect(candidate.facts).toBeNull();
                // 후보 판정의 빈 값 확인
                expect(candidate.judgment).toBeNull();
            }
            // 실행환경 환경설정 재생 규정목록 출력에 따른 처리 경로 분기
            if (process.env.REPLAY_RULES_OUTPUT)
                // 쓰기 결과 처리 수행
                writeFileSync(process.env.REPLAY_RULES_OUTPUT, JSON.stringify(publicView, null, 2));
        }
    );
});
