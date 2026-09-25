import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { interactionFixture } from "../fixtures/interaction";
import { incidentQuery } from "../../src/adapters/incidents";
import { incidentDigest } from "../../src/rules/engine/incidents/evidence";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { JobStore, Sha256, StatusStore } from "@replay/adapters";
import { client } from "@replay/database";
import { report, result as submitResult, status, type AnalysisPayload } from "@replay/application";
import { perceptionAdmission } from "@replay/rule-engine";
import { perceptionRunData } from "@replay/shared-types";
import {
    avPerceptionPayload,
    PERCEPTION_ANALYSIS_ID,
    PERCEPTION_JOB_ID
} from "../fixtures/perception";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 현재시각 시험용 2030 01 00 00 준비
const NOW = "2030-01-01T12:00:00.000Z";
// 만료시각 시험용 2030 01 00 00 준비
const EXPIRES = "2030-01-02T12:00:00.000Z";

describe.skipIf(!databaseUrl)("private perception result flow", () => {
    // 데이터베이스 주소 부정 조건에 따른 처리 경로 분기
    if (!databaseUrl) return;
    // 데이터베이스 시험용 클라이언트 결과 준비
    const database = client(databaseUrl);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];

    afterEach(async () => {
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const sessionId of sessions.splice(0)) {
            // 분석 조회
            const analyses = await database.sql<
                { id: string }[]
            >`select id from analyses where anonymous_session_id = ${sessionId}`;
            // 분석목록의 각 사례 순회
            for (const row of analyses) {
                // 분석 인식 실행 기록 삭제
                await database.sql`delete from analysis_perception_runs where analysis_id = ${row.id}`;
                // 근거 자산 삭제
                await database.sql`delete from evidence_assets where analysis_id = ${row.id}`;
                // 인식 후보 사건 삭제
                await database.sql`delete from incident_candidates where analysis_id = ${row.id}`;
                // 영상 샷 삭제
                await database.sql`delete from shots where analysis_id = ${row.id}`;
                // 작업 상태 이력 삭제
                await database.sql`delete from processing_job_events where job_id in (select id from processing_jobs where analysis_id = ${row.id})`;
                // 영상 처리 작업 삭제
                await database.sql`delete from processing_jobs where analysis_id = ${row.id}`;
                // 분석 삭제
                await database.sql`delete from analyses where id = ${row.id}`;
            }
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

    // 검증용 새 관측 작업 구성
    const createV2Job = async () => {
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID(),
            videoId = randomUUID(),
            analysisId = randomUUID(),
            jobId = randomUUID();
        // 원본 및 원본 시험용 무작위바이트 결과 준비
        const source = randomBytes(32),
            sourceHex = source.toString("hex");
        // 임대 토큰 및 해시계산기 시험용 무작위바이트 결과 문자열변환 결과 준비
        const leaseToken = randomBytes(32).toString("hex"),
            hasher = new Sha256();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${randomBytes(32)}, ${NOW}, ${EXPIRES})`;
        // 영상 자산 삽입
        await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${NOW}, ${NOW}, ${EXPIRES})`;
        // 분석 삽입
        await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
      source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source},
      'video-local-observers-av-v1', 'media-v1', ${NOW}, ${EXPIRES})`;
        // 영상 처리 작업 삽입
        await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
      attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
      values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 2, 1, 3, 'worker-1',
      ${Buffer.from(await hasher.sha256(leaseToken))}, ${EXPIRES}, ${NOW}, ${NOW})`;
        // 전송자료 시험용 깊은복사 결과 준비
        const payload = structuredClone(avPerceptionPayload()) as any;
        // 전송자료 인식 원본 해시를 원본 값으로 설정
        payload.perception.sourceSha256 = sourceHex;
        // 전송자료 인식 음향 원본 해시를 원본 값으로 설정
        payload.perception.audio.sourceSha256 = sourceHex;
        // 전송자료 인식 산출물 객체 키를 전송자료 인식 산출물 객체 키 결과 값으로 설정
        payload.perception.artifact.objectKey = payload.perception.artifact.objectKey
            .replace(PERCEPTION_ANALYSIS_ID, analysisId)
            .replace(PERCEPTION_JOB_ID, jobId);
        // 전송자료 근거의 각 사례 순회
        for (const item of payload.evidence) {
            // 항목 객체 키를 항목 객체 키 결과 값으로 설정
            item.objectKey = item.objectKey
                .replace(PERCEPTION_ANALYSIS_ID, analysisId)
                .replace(PERCEPTION_JOB_ID, jobId);
        }
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(payload.perception)).toBe(true);
        // 메타정보목록 시험용 대응표 준비
        const heads = new Map<string, { sizeBytes: number; contentSha256: Uint8Array }>([
            [
                payload.perception.artifact.objectKey,
                {
                    sizeBytes: 1_024,
                    contentSha256: Uint8Array.from(
                        Buffer.from(payload.perception.artifact.contentSha256, "hex")
                    )
                }
            ],
            ...payload.evidence.map(
                (item: any, index: number) =>
                    [
                        item.objectKey,
                        {
                            sizeBytes: index === 0 ? 2_048 : 4_096,
                            contentSha256: Uint8Array.from(Buffer.from(item.contentSha256, "hex"))
                        }
                    ] as const
            )
        ]);
        // 저장공간 시험 입력으로 메타정보 자료 생성
        const storage = {
            head: async (key: string, maximum?: number) => {
                // 메타정보 시험용 메타정보목록 조회 결과 준비
                const head = heads.get(key);
                // 입력 조건 반환
                return head && head.sizeBytes <= (maximum ?? Infinity) ? head : null;
            }
        };
        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(database, () => new Date(NOW));
        // 시계 시험 입력으로 현재시각 자료 생성
        const clock = { now: () => new Date(NOW) };
        // 입력 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 자료 생성
        const input = {
            jobId,
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken,
            payload: payload as AnalysisPayload
        };
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 자료 반환
        return {
            sessionId,
            videoId,
            analysisId,
            jobId,
            source,
            payload: payload as AnalysisPayload,
            heads,
            storage,
            repository,
            clock,
            hasher,
            input
        };
    };

    // 검증용 새 관측 미저장 확인 구성
    const expectNoV2Writes = async (analysisId: string, jobId: string) => {
        // 영상 샷 조회
        const [counts] = await database.sql<
            { shots: number; candidates: number; evidence: number; runs: number }[]
        >`
      select (select count(*)::int from shots where analysis_id = ${analysisId}) as shots,
             (select count(*)::int from incident_candidates where analysis_id = ${analysisId}) as candidates,
             (select count(*)::int from evidence_assets where analysis_id = ${analysisId}) as evidence,
             (select count(*)::int from analysis_perception_runs where analysis_id = ${analysisId}) as runs`;
        // 집계의 샷목록 0 및 후보목록 0 및 근거 0 및 지정 항목 0 자료 기준 구조 일치 확인
        expect(counts).toEqual({ shots: 0, candidates: 0, evidence: 0, runs: 0 });
        // 분석 조회
        const [state] = await database.sql<{ analysis_status: string; job_status: string }[]>`
      select analysis.status as analysis_status, job.status as job_status
      from analyses as analysis join processing_jobs as job on job.analysis_id = analysis.id
      where analysis.id = ${analysisId} and job.id = ${jobId}`;
        // 상태의 분석 상태 대기중 및 작업 상태 지정 문자열 자료 기준 구조 일치 확인
        expect(state).toEqual({ analysis_status: "QUEUED", job_status: "PROCESSING" });
    };

    // 실제 파이썬 관측과 제출 증거를 현재 작업의 고정 경로에 연결
    const privateFixture = async (typed = false) => {
        const setup = await createV2Job();
        await database.sql`update video_assets set duration_ms = 2000 where id = ${setup.videoId}`;
        const payload = setup.payload as any;
        const observation = interactionFixture(setup.source.toString("hex"), 1000);
        const media = payload.evidence[1];
        const prior = setup.heads.get(media.objectKey)!;
        media.objectKey = `evidence/${setup.analysisId}/${setup.jobId}/2/${media.contentSha256}/candidate-0001.mp4`;
        setup.heads.set(media.objectKey, prior);
        observation.evidence = [{ evidenceIndex: 1, kind: "CLIP", path: "clips/candidate-0001.mp4",
            timestampMs: 1000, startMs: media.startMs, endMs: media.endMs, contentSha256: media.contentSha256,
            coversMeasurementWindow: true }];
        if (typed) {
            const provenance = { state: "HYPOTHESIS" as const, reasons: ["METHOD_UNVALIDATED"],
                method: { id: "fixture", version: "1" }, observationIds: [observation.observationId] };
            observation.actionType = { ...provenance, value: "HOLDING_MOTION" };
            observation.direction = { ...provenance, value: "A_TO_B" };
        }
        const raw = [{ kind: "HEADER", sourceSha256: observation.sourceSha256 },
            { kind: "INTERACTION_OBSERVATION_HEADER", sourceSha256: observation.sourceSha256, schemaVersion: "interaction-observation-v1" },
            observation, { kind: "INTERACTION_OBSERVATION_SUMMARY", sourceSha256: observation.sourceSha256, observationCount: 1 }];
        const body = gzipSync(raw.map((row) => JSON.stringify(row)).join("\n") + "\n");
        const hash = createHash("sha256").update(body).digest("hex");
        payload.perception.artifact = { ...payload.perception.artifact, contentSha256: hash, sizeBytes: body.length,
            objectKey: `perception/${setup.analysisId}/${setup.jobId}/2/${hash}.jsonl.gz` };
        setup.heads.set(payload.perception.artifact.objectKey, { sizeBytes: body.length, contentSha256: Buffer.from(hash, "hex") });
        return { ...setup, privateStorage: { body: async () => ({ body: (async function* () { yield body; })() }) } };
    };

    it.each([false, true])("stores private interaction lineage without public facts for typed=%s", async (typed) => {
        const setup = await privateFixture(typed);
        expect(await submitResult(setup)(setup.input)).toEqual({ kind: "ACCEPTED" });
        const saved = await incidentQuery(database, { analysisId: setup.analysisId,
            anonymousSessionId: setup.sessionId, after: null, limit: 100 }, NOW);
        expect(saved?.rows).toHaveLength(1);
        expect(saved?.rows[0]?.record === null).toBe(!typed);
        if (typed) expect(saved?.rows[0]?.admitted_fact_ids).toEqual([]);
        expect(await incidentQuery(database, { analysisId: setup.analysisId,
            anonymousSessionId: randomUUID(), after: null, limit: 100 }, NOW)).toBeNull();
        expect(await incidentQuery(database, { analysisId: setup.analysisId,
            anonymousSessionId: setup.sessionId, after: null, limit: 100 }, EXPIRES)).toBeNull();
        const publicReport = await report({ clock: setup.clock, repository: new StatusStore(database) })({
            anonymousSessionId: setup.sessionId, analysisId: setup.analysisId
        });
        expect(JSON.stringify(publicReport)).not.toContain("INTERACTION_OBSERVATION");
        expect(JSON.stringify(publicReport)).not.toContain("incident-record-v1");
        expect(await submitResult(setup)(setup.input)).toEqual({ kind: "ALREADY_FINISHED" });
        const counts = await database.sql`select count(*)::int as count from analysis_incident_observations where analysis_id = ${setup.analysisId}`;
        expect(counts[0]?.count).toBe(1);
        // 이전 작업 판본에 저장된 관측은 현재 조회에서 제외
        await database.sql`update processing_jobs set job_revision = job_revision + 1 where id = ${setup.jobId}`;
        expect((await incidentQuery(database, { analysisId: setup.analysisId,
            anonymousSessionId: setup.sessionId, after: null, limit: 100 }, NOW))?.rows).toEqual([]);
    });

    it("rejects a record evidence hash changed independently of its verified observation", async () => {
        const setup = await privateFixture(true);
        const repository = {
            preflight: setup.repository.preflight.bind(setup.repository),
            result: (command: import("../../src/application/ports/repositories/job-store").JobResultCommand) => {
                const batch = structuredClone(command.privateIncidents!);
                const row = batch.rows[0]!;
                const record = { ...row.record!, evidence: row.record!.evidence.map((item) => ({ ...item, contentSha256: "e".repeat(64) })) };
                return setup.repository.result({ ...command, privateIncidents: { ...batch,
                    rows: [{ ...row, record, recordSha256: incidentDigest(record) }] } });
            }
        };
        await expect(submitResult({ ...setup, repository })(setup.input)).rejects.toThrow("INCIDENT_RECORD_EVIDENCE_MISMATCH");
        await expectNoV2Writes(setup.analysisId, setup.jobId);
    });

    it.each(["deleted", "expired", "during-write"])("rejects private writes for a source %s", async (kind) => {
        const setup = await privateFixture();
        if (kind === "deleted") await database.sql`update video_assets set status = 'DELETED' where id = ${setup.videoId}`;
        if (kind === "expired") await database.sql`update video_assets set created_at = '2029-12-30', expires_at = '2029-12-31' where id = ${setup.videoId}`;
        let repository = setup.repository;
        if (kind === "during-write") {
            await database.sql`update video_assets set expires_at = '2030-01-01T12:00:01Z' where id = ${setup.videoId}`;
            let reads = 0;
            repository = new JobStore(database, () => new Date(++reads < 3 ? NOW : "2030-01-01T12:00:01Z"));
        }
        expect(await submitResult({ ...setup, repository })(setup.input)).toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        await expectNoV2Writes(setup.analysisId, setup.jobId);
        const rows = await database.sql`select id from analysis_incident_observations where analysis_id = ${setup.analysisId}`;
        expect(rows).toHaveLength(0);
    });

    it("rolls back all result writes if a private row fails inside the transaction", async () => {
        const setup = await privateFixture();
        const repository = {
            preflight: setup.repository.preflight.bind(setup.repository),
            result: (command: import("../../src/application/ports/repositories/job-store").JobResultCommand) => {
                const batch = command.privateIncidents!;
                return setup.repository.result({ ...command, privateIncidents: { ...batch,
                    rows: [...batch.rows, { ...batch.rows[0]!, observationSha256: "0".repeat(64) }] } });
            }
        };
        await expect(submitResult({ ...setup, repository })(setup.input)).rejects.toThrow("INCIDENT_ROW_INVALID");
        await expectNoV2Writes(setup.analysisId, setup.jobId);
        const rows = await database.sql`select id from analysis_incident_observations where analysis_id = ${setup.analysisId}`;
        expect(rows).toHaveLength(0);
        // 같은 트랜잭션의 자동 평가와 성공 이벤트까지 되돌림 확인
        const automatic = await database.sql`select id from analysis_automatic_reviews where analysis_id = ${setup.analysisId}`;
        const events = await database.sql`select id from processing_job_events where job_id = ${setup.jobId} and event_type = 'SUCCEEDED'`;
        expect(automatic).toHaveLength(0);
        expect(events).toHaveLength(0);
    });

    it("completes v2 through result use case and JobStore with audio private and not public", async () => {
        // 시험자료 결과를 시험환경에 저장
        const setup = await createV2Job();
        // 결과 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            submitResult({
                clock: setup.clock,
                hasher: setup.hasher,
                repository: setup.repository,
                storage: setup.storage
            })(setup.input)
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 분석 인식 실행 기록 조회
        const [saved] = await database.sql<
            { schema_version: string; pipeline_version: string; summary: Record<string, any> }[]
        >`
      select schema_version, pipeline_version, summary from analysis_perception_runs
      where analysis_id = ${setup.analysisId}`;
        // 저장결과의 스키마 버전 인식 실행 및 파이프라인 버전 영상 로컬자료 자료의 필드 일치 확인
        expect(saved).toMatchObject({
            schema_version: "perception-run-v2",
            pipeline_version: "video-local-observers-av-v1"
        });
        // 저장결과 요약 음향의 시험환경 전송자료 인식 음향 기준 구조 일치 확인
        expect(saved?.summary.audio).toEqual((setup.payload.perception as any).audio);
        // 규정 입력 채택 거부 및 음향 단서 방법 미검증 및 발화 미분석 조건을 포함한 기대 결과 일치 확인
        expect(saved?.summary.admission).toMatchObject({
            status: "NOT_ADMITTED",
            reasons: expect.arrayContaining([
                "AUDIO_CUE_METHOD_NOT_VERIFIED",
                "SPEECH_NOT_ANALYZED"
            ])
        });
        // 자동 규정 평가 기록 조회
        const [automatic] = await database.sql<
            {
                summary: { rows: Array<{ status: string }>; evaluatedCount: number };
                evidence_bindings: unknown[];
            }[]
        >`
      select summary, evidence_bindings from analysis_automatic_reviews where analysis_id = ${setup.analysisId}`;
        // 자동평가 요약 평가완료 개수의 기대값 0 일치 확인
        expect(automatic?.summary.evaluatedCount).toBe(0);
        // 자동평가 요약 행목록 길이의 기대값 시험환경 전송자료 후보목록 길이 일치 확인
        expect(automatic?.summary.rows.length).toBe(setup.payload.candidates.length);
        // 자동평가 요약 행목록 전체충족 결과의 기대값 참 일치 확인
        expect(automatic?.summary.rows.every((row) => row.status === "BLOCKED")).toBe(true);
        // 자동평가 근거 길이의 기대값 시험환경 전송자료 근거 길이 일치 확인
        expect(automatic?.evidence_bindings.length).toBe(setup.payload.evidence?.length);
        // 공개 저장소 시험용 상태 저장소 준비
        const publicStore = new StatusStore(database);
        // 보고서 결과를 공개보고서에 저장
        const publicReport = await report({ clock: setup.clock, repository: publicStore })({
            anonymousSessionId: setup.sessionId,
            analysisId: setup.analysisId
        });
        // 상태 결과를 공개 상태에 저장
        const publicStatus = await status({ clock: setup.clock, repository: publicStore })({
            anonymousSessionId: setup.sessionId,
            videoAssetId: setup.videoId
        });
        // 2개 항목 목록의 각 사례 순회
        for (const view of [publicReport, publicStatus]) {
            // 응답본문 직렬화 결과의 음향 관측목록 미포함 확인
            expect(JSON.stringify(view)).not.toContain("audio-observations-v1");
            // 응답본문 직렬화 결과의 지정 문자열 미포함 확인
            expect(JSON.stringify(view)).not.toContain("spectral-multitone-v1");
            // 응답본문 직렬화 결과의 자동평가 요약 미포함 확인
            expect(JSON.stringify(view)).not.toContain("automaticReviewSummary");
            // 응답본문 직렬화 결과의 진단 미포함 확인
            expect(JSON.stringify(view)).not.toContain("diagnostics");
        }
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(publicReport).toMatchObject({
            resultPolicy: "COMPLETED_ONLY",
            evaluatedCount: 0,
            judgmentStatus: "NOT_EVALUATED"
        });
    });

    it("rejects a changed source at locked storage write with no partial rows", async () => {
        // 시험자료 결과를 시험환경에 저장
        const setup = await createV2Job();
        // 저장소 시험 입력으로 사전점검 및 결과 자료 생성
        const repository = {
            preflight: (command: Parameters<JobStore["preflight"]>[0]) =>
                setup.repository.preflight(command),
            result: async (command: Parameters<JobStore["result"]>[0]) => {
                // 분석 갱신
                await database.sql`update analyses set source_fingerprint = ${randomBytes(32)} where id = ${setup.analysisId}`;
                // 시험환경 저장소 결과 반환
                return setup.repository.result(command);
            }
        };
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            submitResult({
                clock: setup.clock,
                hasher: setup.hasher,
                repository,
                storage: setup.storage
            })(setup.input)
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 실패한 제출의 새 인식 자료 미저장 확인
        await expectNoV2Writes(setup.analysisId, setup.jobId);
    });

    it("rejects an audio clip checksum mismatch before any v2 row is written", async () => {
        // 시험자료 결과를 시험환경에 저장
        const setup = await createV2Job();
        // 시험환경 메타정보목록 묶음 결과 처리 수행
        setup.heads.set(setup.payload.evidence![1]!.objectKey, {
            sizeBytes: 4_096,
            contentSha256: Uint8Array.from(Buffer.from("e".repeat(64), "hex"))
        });
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            submitResult({
                clock: setup.clock,
                hasher: setup.hasher,
                repository: setup.repository,
                storage: setup.storage
            })(setup.input)
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "REFERENCE" });
        // 실패한 제출의 새 인식 자료 미저장 확인
        await expectNoV2Writes(setup.analysisId, setup.jobId);
    });

    it("persists one immutable private run without exposing it as media or an evaluation", async () => {
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID(),
            videoId = randomUUID(),
            analysisId = randomUUID(),
            jobId = randomUUID();
        // 원본 및 원본 시험용 무작위바이트 결과 준비
        const source = randomBytes(32),
            sourceHex = source.toString("hex");
        // 산출물 및 근거 시험용 지정 문자열 반복문자열 결과 준비
        const artifactSha = "b".repeat(64),
            evidenceSha = "c".repeat(64);
        // 임대 시험용 바이트배열 변환 결과 준비
        const lease = Uint8Array.from(randomBytes(32));
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${randomBytes(32)}, ${NOW}, ${EXPIRES})`;
        // 영상 자산 삽입
        await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${NOW}, ${NOW}, ${EXPIRES})`;
        // 분석 삽입
        await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
      source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source},
      'video-local-observers-v1', 'media-v1', ${NOW}, ${EXPIRES})`;
        // 영상 처리 작업 삽입
        await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
      attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
      values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 2, 1, 3, 'worker-1', ${Buffer.from(lease)},
      ${EXPIRES}, ${NOW}, ${NOW})`;

        // 전송자료 시험 입력으로 종류 지정 문자열 및 파이프라인 버전 영상 로컬자료 및 한계목록 및 샷목록 자료 생성
        const payload: AnalysisPayload = {
            kind: "ANALYZED",
            pipelineVersion: "video-local-observers-v1",
            limitations: [],
            shots: [
                {
                    index: 0,
                    startMs: 0,
                    endMs: 2_000,
                    playbackSpeed: "NORMAL",
                    isReplay: false,
                    cameraAngle: null
                }
            ],
            candidates: [
                {
                    index: 1,
                    category: "OTHER",
                    startMs: 500,
                    endMs: 1_500,
                    anchorMs: 1_000,
                    confidence: 0.5,
                    cameraSufficiency: "MEDIUM",
                    reasons: [],
                    shotIndices: [0]
                }
            ],
            evidence: [
                {
                    candidateIndex: 1,
                    kind: "FRAME",
                    objectKey: `evidence/${analysisId}/${jobId}/frame.jpg`,
                    contentSha256: evidenceSha,
                    startMs: 1_000,
                    endMs: 1_000,
                    width: 1_920,
                    height: 1_080
                }
            ],
            perception: {
                schemaVersion: "perception-run-v1",
                sourceSha256: sourceHex,
                // 예정된 표본 처리 완료 표시이며 파울 판정 완료와 별개
                processingStatus: "COMPLETE",
                // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
                coverage: {
                    startMs: 0,
                    endMs: 2_000,
                    sampleIntervalMs: 500,
                    // 누락 여부 비교에 사용할 예정 표본 수 설정
                    expectedSamples: 4,
                    // 실제로 처리한 표본 수 설정이며 판정 사건 수와 구분
                    processedSamples: 4,
                    // 처리에 실패한 표본 수 설정
                    failedSamples: 0
                },
                // 모델 출처와 고정된 개정번호 및 가중치 해시 대조용 목록 구성
                models: [
                    {
                        component: "detector",
                        modelId: "PekingU/rtdetr_r18vd",
                        revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753",
                        weightsSha256:
                            "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093"
                    },
                    {
                        component: "role",
                        modelId: "martinjolif/yolo-football-player-detection",
                        revision: "5e83fafa8d564243001ce8e063612a618a138fbe",
                        weightsSha256:
                            "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd"
                    },
                    {
                        component: "pose",
                        modelId: "usyd-community/vitpose-plus-small",
                        revision: "0c30b6534bb621af0162b481176742577264e36e",
                        weightsSha256:
                            "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9"
                    }
                ],
                artifact: {
                    objectKey: `perception/${analysisId}/${jobId}/2/${artifactSha}.jsonl.gz`,
                    contentType: "application/gzip",
                    contentSha256: artifactSha,
                    sizeBytes: 1_024
                },
                summary: {
                    roleObservationCount: 1,
                    poseObservationCount: 1,
                    officialCueCount: 0,
                    interactionCount: 1,
                    linkCount: 1,
                    truncated: false,
                    reasons: []
                },
                // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
                incidents: [
                    {
                        id: "incident-1",
                        candidateIndex: 1,
                        continuityId: 1,
                        startMs: 600,
                        endMs: 1_400,
                        // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                        evidenceIndices: [0],
                        // 심판 역할을 알 수 없는 관측 상태 보존
                        officialRole: "UNKNOWN",
                        // 심판 신호를 알 수 없는 관측 상태 보존
                        signal: "UNKNOWN",
                        // 접촉 미검증 상태이며 실제 접촉 사실로 채택하지 않음
                        contact: "UNVERIFIED",
                        // 원심을 알 수 없는 상태이며 판정 내용을 추정하지 않음
                        originalDecision: "UNKNOWN",
                        // 재개 미검증 상태이며 재개 사실로 채택하지 않음
                        restart: "UNVERIFIED",
                        reasons: ["method-not-verified"]
                    }
                ]
            }
        };
        // 시험자료 시험용 전송자료 준비
        const boundary = payload as any;
        // 시험자료 인식 사건목록을 배열 변환 결과 값으로 설정
        boundary.perception.incidents = Array.from({ length: 128 }, (_, index) => ({
            id: `incident-${index}-`.padEnd(128, "x"),
            candidateIndex: 1,
            continuityId: index,
            startMs: 600,
            endMs: 1_400,
            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
            evidenceIndices: [0],
            // 심판 역할을 알 수 없는 관측 상태 보존
            officialRole: "UNKNOWN",
            // 심판 신호를 알 수 없는 관측 상태 보존
            signal: "UNKNOWN",
            // 접촉 미검증 상태이며 실제 접촉 사실로 채택하지 않음
            contact: "UNVERIFIED",
            // 원심을 알 수 없는 상태이며 판정 내용을 추정하지 않음
            originalDecision: "UNKNOWN",
            // 재개 미검증 상태이며 재개 사실로 채택하지 않음
            restart: "UNVERIFIED",
            reasons: Array.from({ length: 11 }, (__, reason) =>
                `${index}-${reason}-`.padEnd(128, "r")
            )
        }));
        // 시험자료 인식 요약을 관측 개수 5_000 및 관측 개수 5_000 및 단서 개수 128 및 개수 4_000 자료로 설정
        boundary.perception.summary = {
            roleObservationCount: 5_000,
            poseObservationCount: 5_000,
            officialCueCount: 128,
            interactionCount: 4_000,
            linkCount: 0,
            truncated: true,
            reasons: []
        };
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(payload.perception)).toBe(true);
        // 수용결과 시험용 인식 수용결과 결과 준비
        const admission = perceptionAdmission(payload.perception!, {
            // 서버가 저장 맥락을 확인한 시험 조건이며 인식 방법 승인과 별개
            serverVerified: true,
            pipelineVersion: payload.pipelineVersion,
            sourceSha256: sourceHex,
            artifact: {
                objectKey: payload.perception!.artifact.objectKey,
                contentSha256: artifactSha,
                sizeBytes: 1_024
            },
            // 후보별 근거 위치와 내용 해시를 대조할 참조 목록 구성
            references: [
                {
                    evidenceIndex: 0,
                    candidateIndex: 1,
                    startMs: 1_000,
                    endMs: 1_000,
                    declaredContentSha256: evidenceSha,
                    verifiedContentSha256: evidenceSha
                }
            ],
            // 경기와 연결된 규정 판본의 검증 맥락 구성
            ruleEdition: null
        });
        // 비공개 시험 입력으로 기존 항목 및 상태 및 분석범위 및 사건목록 자료 생성
        const privateEnvelope = {
            ...payload.perception!.summary,
            processingStatus: payload.perception!.processingStatus,
            // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
            coverage: payload.perception!.coverage,
            // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
            incidents: payload.perception!.incidents,
            admission
        };
        // 바이트버퍼 길이 결과의 256 비교 조건 이하 확인
        expect(Buffer.byteLength(JSON.stringify(payload.perception), "utf8")).toBeLessThanOrEqual(
            256 * 1_024
        );
        // 바이트버퍼 길이 결과의 256 비교 조건 초과 확인
        expect(Buffer.byteLength(JSON.stringify(privateEnvelope), "utf8")).toBeGreaterThan(
            256 * 1_024
        );
        // 바이트버퍼 길이 결과의 1_048_576 이하 확인
        expect(Buffer.byteLength(JSON.stringify(privateEnvelope), "utf8")).toBeLessThanOrEqual(
            1_048_576
        );

        // 저장소 시험용 작업 저장소 준비
        const repository = new JobStore(database, () => new Date(NOW));
        // 저장소 사전점검 결과의 종류 지정 문자열 및 규정 판본 빈 값 자료의 필드 일치 확인
        await expect(
            repository.preflight({
                jobId,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: lease,
                now: NOW
            })
        ).resolves.toMatchObject({ kind: "AUTHORIZED", ruleEdition: null });
        // 저장소 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            repository.result({
                jobId,
                workerId: "worker-1",
                jobRevision: 2,
                leaseTokenHash: lease,
                now: NOW,
                payload,
                perceptionVerification: { analysisId, sourceSha256: source, admission }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 분석 인식 실행 기록 조회
        const [stored] = await database.sql<
            { artifact_object_key: string; summary: Record<string, unknown>; expires_at: string }[]
        >`
      select artifact_object_key, summary, expires_at from analysis_perception_runs where analysis_id = ${analysisId}`;
        // 저장값 산출물 객체 키의 기대값 전송자료 인식 산출물 객체 키 일치 확인
        expect(stored?.artifact_object_key).toBe(payload.perception!.artifact.objectKey);
        // 규정 입력 채택 거부 조건을 포함한 기대 결과 일치 확인
        expect(stored?.summary).toMatchObject({
            admission: { status: "NOT_ADMITTED" },
            // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
            incidents: payload.perception!.incidents
        });
        // 날짜 표준시각문자열 결과의 기대값 만료시각 일치 확인
        expect(new Date(stored!.expires_at).toISOString()).toBe(EXPIRES);
        // 근거 자산 조회 결과의 행 수가 0개임 확인
        expect(
            await database.sql`select id from evidence_assets where object_key like 'perception/%'`
        ).toHaveLength(0);
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(
            database.sql`update analysis_perception_runs set artifact_size_bytes = 0 where analysis_id = ${analysisId}`
        ).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(
            database.sql`update analysis_perception_runs set source_sha256 = ${Buffer.from([1])} where analysis_id = ${analysisId}`
        ).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(
            database.sql`update analysis_perception_runs set summary = '[]'::jsonb where analysis_id = ${analysisId}`
        ).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(database.sql`update analysis_perception_runs set summary = jsonb_build_object(
      'incidents', '[]'::jsonb, 'admission', jsonb_build_object('padding', repeat('x', 1048576))
    ) where analysis_id = ${analysisId}`).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(database.sql`update analysis_perception_runs set schema_version = 'perception-run-v2'
      where analysis_id = ${analysisId}`).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(database.sql`update analysis_perception_runs set pipeline_version = 'video-local-observers-av-v1'
      where analysis_id = ${analysisId}`).rejects.toThrow();
        // 입력 조건의 잘못된 입력의 예외 발생 확인
        await expect(database.sql`update analysis_perception_runs set schema_version = 'perception-run-v2',
      pipeline_version = 'video-local-observers-av-v1' where analysis_id = ${analysisId}`).rejects.toThrow();
        // 분석 인식 실행 기록 갱신
        await database.sql`update analysis_perception_runs set schema_version = 'perception-run-v2',
      pipeline_version = 'video-local-observers-av-v1',
      summary = jsonb_set(summary, '{audio}', ${JSON.stringify({ version: "audio-observations-v1" })}::jsonb)
      where analysis_id = ${analysisId}`;
        // 분석 인식 실행 기록 조회
        const [audioRow] = await database.sql<{ summary: Record<string, unknown> }[]>`
      select summary from analysis_perception_runs where analysis_id = ${analysisId}`;
        // 음향 행 요약 음향의 버전 음향 관측목록 자료 기준 구조 일치 확인
        expect(audioRow?.summary.audio).toEqual({ version: "audio-observations-v1" });

        // 어댑터 시험용 상태 저장소 준비
        const adapter = new StatusStore(database);
        // 어댑터 분석 결과를 내부에 저장
        const internal = await adapter.analysis({
            anonymousSessionId: sessionId,
            analysisId,
            now: NOW
        });
        // 응답본문 직렬화 결과의 산출물 객체 키 미포함 확인
        expect(JSON.stringify(internal)).not.toContain("artifactObjectKey");
        // 접촉 인식 방법 미검증 값이 결과에 포함되지 않음 확인
        expect(JSON.stringify(internal)).not.toContain("CONTACT_METHOD_NOT_VERIFIED");
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(internal).toMatchObject({ judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0 });
        // 상태 결과를 시험자료에 저장
        const media = await status({ clock: { now: () => new Date(NOW) }, repository: adapter })({
            anonymousSessionId: sessionId,
            videoAssetId: videoId
        });
        // 보고서 결과를 공개보고서에 저장
        const publicReport = await report({
            clock: { now: () => new Date(NOW) },
            repository: adapter
        })({
            anonymousSessionId: sessionId,
            analysisId
        });
        // 2개 항목 목록의 각 사례 순회
        for (const view of [media, publicReport]) {
            // 응답본문 직렬화 결과의 산출물 객체 키 미포함 확인
            expect(JSON.stringify(view)).not.toContain("artifactObjectKey");
            // 접촉 인식 방법 미검증 값이 결과에 포함되지 않음 확인
            expect(JSON.stringify(view)).not.toContain("CONTACT_METHOD_NOT_VERIFIED");
            // 응답본문 직렬화 결과의 인식 미포함 확인
            expect(JSON.stringify(view)).not.toContain("perception/");
        }
    });
});
