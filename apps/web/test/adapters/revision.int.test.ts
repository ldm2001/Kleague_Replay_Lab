import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluationStore, statusStore } from "@replay/adapters";
import { assessment } from "@replay/application";
import { client } from "@replay/database";
import { competitionSet, ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { judgment } from "../fixtures/result";

// 별도 테스트 데이터베이스에서 사실 버전과 판정의 연결 확인
describe.skipIf(!process.env.DATABASE_URL)("사실 버전", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = process.env.DATABASE_URL ? client() : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;
    // 저장소 시험용 저장소 결과 준비
    const store = evaluationStore(database);
    // 상태 시험용 상태 저장소 결과 준비
    const status = statusStore(database);
    // 현재시각 시험용 2026 09 00 00 준비
    const now = "2026-09-05T00:00:00.000Z";
    // 만료시각 시험용 2026 09 00 00 준비
    const expires = "2026-09-06T00:00:00.000Z";
    // 세션 보관 변수 생성
    let session: string;
    // 영상 보관 변수 생성
    let video: string;
    // 분석 보관 변수 생성
    let analysis: string;
    // 후보 보관 변수 생성
    let candidate: string;

    // 내용 해시 계산
    const hash = (value: string) => createHash("sha256").update(value).digest();
    // 시험자료 시험용 평가 결과 준비
    const engine = assessment({
        rule: ruleSet,
        competitionRule: competitionSet,
        push: pushResult,
        variable: varResult,
        hash: async (value) => hash(value)
    });

    beforeEach(async () => {
        // 테스트별 소유 세션과 장면 생성
        session = randomUUID();
        // 영상을 무작위식별자 결과 값으로 설정
        video = randomUUID();
        // 분석을 무작위식별자 결과 값으로 설정
        analysis = randomUUID();
        // 후보를 무작위식별자 결과 값으로 설정
        candidate = randomUUID();
        // 익명 세션 삽입
        await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session}, ${hash(session)}, ${now}, ${expires})`;
        // 영상 자산 삽입
        await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video}, ${session}, ${video}, ${hash(video)}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
        // 대회 규정 판본 조회
        const [version] =
            await database.sql`select id from competition_rule_versions where competition = 'K리그1' and season = '2026' and ifab_edition = '2026-27' limit 1`;
        // 분석 삽입
        await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at) values (${analysis}, ${session}, ${video}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${now}, ${expires})`;
        // 인식 후보 사건 삽입
        await database.sql`insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, camera_sufficiency, review_status) values (${candidate}, ${analysis}, 1, 'GOAL_DISALLOWED', 0, 2000, 'HIGH', 'UNREVIEWED')`;
    });
    afterEach(async () => {
        // 분석 삭제
        await database.sql`delete from analyses where anonymous_session_id = ${session}`;
        // 영상 자산 삭제
        await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
        // 익명 세션 삭제
        await database.sql`delete from anonymous_sessions where id = ${session}`;
    });
    afterAll(() => database.close());

    // 검증용 개정 이력 구성
    const revision = (key: string, expected: string | null = null, facts = judgment.facts) => ({
        anonymousSessionId: session,
        analysisId: analysis,
        candidateId: candidate,
        expectedFactRevisionId: expected,
        facts,
        keyHash: hash(key),
        requestHash: hash(JSON.stringify({ expected, facts })),
        now
    });

    // 검증용 판정 구성
    const decision = async () => {
        // 저장 직전 평가 문맥 확보
        const context = await store.context({
            anonymousSessionId: session,
            analysisId: analysis,
            candidateId: candidate,
            now
        });
        // 맥락 종류 비교 조건에 따른 처리 경로 분기
        if (context.kind !== "READY") throw new Error("context-unavailable");
        // 평가 반환값 결과를 결과에 저장
        const result = await engine({
            ruleVersionId: context.value.ruleVersionId,
            ...(context.value.competition ? { competition: context.value.competition } : {}),
            push: context.value.facts.push,
            variable: context.value.facts.variable,
            observed: context.value.facts.observed,
            options: context.value.competitionOptions
        });
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "EVALUATED") throw new Error("evaluation-unavailable");
        // 익명 세션 식별자 및 분석 식별자 및 후보 식별자 및 분석상태버전 자료 반환
        return {
            anonymousSessionId: session,
            analysisId: analysis,
            candidateId: candidate,
            analysisStateVersion: context.value.analysisStateVersion,
            factRevisionId: context.value.factRevisionId,
            ruleVersionId: context.value.ruleVersionDbId,
            facts: context.value.facts,
            evaluation: result.value,
            ruleEngineVersion: "test-v1",
            evaluationSchemaVersion: 1,
            now
        };
    };

    it("수정 후 재평가", async () => {
        // 첫 판정 저장
        const initial = await store.patch(revision("first"));
        // 시험자료 종류 비교 조건에 따른 처리 경로 분기
        if (initial.kind !== "CREATED") throw new Error("revision-unavailable");
        // 판정 저장 전에도 최신 사실과 개정 이력 조회 가능
        expect(
            await status.analysis({ anonymousSessionId: session, analysisId: analysis, now })
        ).toMatchObject({
            candidates: [
                { factRevisionId: initial.factRevisionId, facts: judgment.facts, judgment: null }
            ]
        });
        // 판정 결과를 시험자료에 저장
        const previous = await decision();
        // 저장소 저장 결과의 종류 생성완료 자료의 필드 일치 확인
        expect(await store.save(previous)).toMatchObject({ kind: "CREATED" });
        // 새 사실을 저장한 뒤 기존 판정을 숨김
        const changed = structuredClone(judgment.facts);
        // 깊은복사 반환값 추가 접촉감지여부 값을 거짓 값으로 설정
        changed.push.contactDetected.value = false;
        // 저장소 수정항목 결과의 종류 생성완료 자료의 필드 일치 확인
        expect(
            await store.patch(revision("second", initial.factRevisionId, changed))
        ).toMatchObject({ kind: "CREATED" });
        // 상태 분석 결과를 화면자료에 저장
        const view = await status.analysis({
            anonymousSessionId: session,
            analysisId: analysis,
            now
        });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(view).toMatchObject({
            status: "CANDIDATES_READY",
            judgmentStatus: "NOT_EVALUATED",
            evaluatedCount: 0,
            candidates: [{ judgment: null }]
        });
        // 오래된 사실 개정번호 내용을 포함한 기대 결과 일치 확인
        expect(await store.save(previous)).toMatchObject({ kind: "STALE_FACT_REVISION" });
        // 새 사실의 판정 완료와 이력 보존 확인
        expect(await store.save(await decision())).toMatchObject({ kind: "CREATED" });
        // 상태 분석 결과를 시험자료에 저장
        const updated = await status.analysis({
            anonymousSessionId: session,
            analysisId: analysis,
            now
        });
        // 시험자료의 상태 완료 및 판정 상태 평가완료 및 평가완료 개수 1 자료의 필드 일치 확인
        expect(updated).toMatchObject({
            status: "COMPLETED",
            judgmentStatus: "EVALUATED",
            evaluatedCount: 1
        });
        // 시험자료 후보목록 중 선택 항목 판정 사실 추가 접촉감지여부 값의 기대값 거짓 일치 확인
        expect(updated?.candidates[0]?.judgment?.facts.push.contactDetected.value).toBe(false);
        // 실제 판정 저장 경로에서 국제축구평의회와 케이리그 근거 연결 확인
        expect(updated?.candidates[0]?.judgment?.citations.map((item) => item.authority)).toEqual(
            expect.arrayContaining(["IFAB", "KLEAGUE"])
        );
        // 규정 판정 결과 조회
        const [history] =
            await database.sql`select count(*)::int as count from decision_results where analysis_id = ${analysis}`;
        // 시험자료 개수의 기대값 2 일치 확인
        expect(history?.count).toBe(2);
    });

    it("모델 관찰과 실제 샷 조회", async () => {
        // 모델 관찰을 판정과 별도 보존
        const observation = {
            model: "gemma3:12b",
            category: "UNKNOWN",
            contact: "UNKNOWN",
            displacement: "uncertain",
            camera: "LOW",
            summary: "가림으로 접촉 확인 어려움",
            timestamps: [200, 800, 1400]
        };
        // 인식 후보 사건 갱신
        await database.sql`update incident_candidates set observation = ${JSON.stringify(observation)}::jsonb where id = ${candidate}`;
        // 샷 시험용 무작위식별자 결과 준비
        const shot = randomUUID();
        // 영상 샷 삽입
        await database.sql`insert into shots (id, analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay) values (${shot}, ${analysis}, 0, 0, 3000, 'UNKNOWN', false)`;
        // 상태 분석 결과를 화면자료에 저장
        const view = await status.analysis({
            anonymousSessionId: session,
            analysisId: analysis,
            now
        });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(view).toMatchObject({
            judgmentStatus: "NOT_EVALUATED",
            candidates: [
                {
                    observation,
                    judgment: null,
                    shots: [{ id: shot, index: 0, startMs: 0, endMs: 3000 }]
                }
            ]
        });
        // 다른 세션의 관찰 조회 차단
        expect(
            await status.analysis({ anonymousSessionId: randomUUID(), analysisId: analysis, now })
        ).toBeNull();
    });

    it("동일 요청 동시 저장", async () => {
        // 같은 키의 동시 요청은 한 번만 생성
        const command = revision("shared");
        // 시험자료 보관 변수 생성
        let unlock!: () => void;
        // 준비완료자료 보관 변수 생성
        let ready!: () => void;
        // 전제조건 시험용 비동기결과 준비
        const gate = new Promise<void>((resolve) => {
            // 시험자료를 경로해결 값으로 설정
            unlock = resolve;
        });
        // 시험자료 시험용 비동기결과 준비
        const locked = new Promise<void>((resolve) => {
            // 준비완료자료를 경로해결 값으로 설정
            ready = resolve;
        });
        // 시험자료 시험용 데이터베이스 질의 결과 준비
        const holder = database.sql.begin(async (transaction) => {
            // 입력 조건 처리 수행
            await transaction`select id from anonymous_sessions where id = ${session} for update`;
            // 준비완료자료 결과 처리 수행
            ready();
            // 전제조건 처리 수행
            await gate;
        });
        // 시험자료 처리 수행
        await locked;
        // 시험자료 시험용 비동기결과 전체 결과 준비
        const pending = Promise.all([store.patch(command), store.patch(command)]);
        // 두 요청 모두 잠금 대기에 진입한 뒤 함께 진행
        try {
            // 시험자료 시험용 날짜 현재시각 결과 비교 조건 준비
            const deadline = Date.now() + 3000;
            // 개수 시험용 0 준비
            let count = 0;
            // 반복 조건에 맞는 시험 사례 순회
            while (Date.now() < deadline) {
                // 실행 중인 데이터베이스 연결 조회
                const [row] = await database.sql`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `;
                // 개수를 행 개수 값으로 설정
                count = row!.count;
                // 개수 비교 조건에 따른 처리 경로 분기
                if (count >= 2) break;
                // 비동기결과 처리 수행
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            // 개수의 2 이상 확인
            expect(count).toBeGreaterThanOrEqual(2);
        } finally {
            // 경합 시험에서 보유한 잠금 해제
            unlock();
            // 데이터베이스 질의 반환값 처리 수행
            await holder;
        }
        // 비동기결과 전체 반환값을 시험자료에 저장
        const results = await pending;
        // 시험자료 항목변환 결과 정렬 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(results.map((item) => item.kind).sort()).toEqual(["CREATED", "REPLAYED"]);
    });
});
