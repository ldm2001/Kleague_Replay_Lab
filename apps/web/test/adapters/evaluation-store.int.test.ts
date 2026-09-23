// 평가 저장소 통합 테스트
import { createHash as digest, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evaluationStore, statusStore } from "@replay/adapters";
import { assessment, decision as evaluateDecision } from "@replay/application";
import { pushResult, varResult } from "@replay/rule-engine";
import { competitionSet, ruleSet } from "@replay/rule-data";
import { client } from "@replay/database";
import {
    observation,
    type EvaluationFacts,
    type EvaluationResult,
    type RuleCitation
} from "@replay/shared-types";
import { context as pushContext } from "../fixtures/push-context";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;
// 현재시각 시험용 2026 09 00 00 준비
const NOW = "2026-09-03T02:00:00.000Z";
// 만료시각 시험용 2026 09 00 00 준비
const EXPIRES = "2026-09-04T02:00:00.000Z";

// 데이터베이스 결과 처리 수행
describeDatabase("PostgreSQL evaluation repository", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = databaseUrl ? client(databaseUrl) : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;
    // 저장소 시험용 저장소 결과 준비
    const repository = evaluationStore(database);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await database.sql`select 1`;
    });

    afterEach(async () => {
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const sessionId of sessions.splice(0)) {
            // 분석 삭제
            await database.sql`delete from analyses where anonymous_session_id = ${sessionId}`;
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

    it.each([
        ["K리그1", "kleague1-2026"],
        ["K리그2", "kleague2-2026"]
    ])(
        "stores facts with shot links and a cited IFAB and %s decision",
        async (competition, versionId) => {
            // 세션 식별자 시험용 무작위식별자 결과 준비
            const sessionId = randomUUID();
            // 영상 식별자 시험용 무작위식별자 결과 준비
            const videoId = randomUUID();
            // 분석 식별자 시험용 무작위식별자 결과 준비
            const analysisId = randomUUID();
            // 후보 식별자 시험용 무작위식별자 결과 준비
            const candidateId = randomUUID();
            // 샷 식별자 시험용 무작위식별자 결과 준비
            const shotId = randomUUID();
            // 세션목록 추가 결과 처리 수행
            sessions.push(sessionId);
            // 익명 세션 삽입
            await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2026-09-02T00:00:00.000Z', ${EXPIRES})
    `;
            // 영상 자산 삽입
            await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([1])}, 'video/mp4', 100, 'VALID', ${competition}, '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
            // 대회 규정 판본 조회
            const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = ${competition} and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
            // 분석 삽입
            await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${NOW}, ${EXPIRES})
    `;
            // 영상 샷 삽입
            await database.sql`
      insert into shots (id, analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay, camera_angle_label)
      values (${shotId}, ${analysisId}, 0, 0, 2000, 'NORMAL', null, 'MAIN')
    `;
            // 인식 후보 사건 삽입
            await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, anchor_ms, detection_confidence, camera_sufficiency, reasons, shot_indices, review_status)
      values (${candidateId}, ${analysisId}, 1, 'PENALTY_NOT_GIVEN', 0, 1800, 900, .8, 'HIGH', '[]'::jsonb, '[0]'::jsonb, 'UNREVIEWED')
    `;

            // 사실 시험 입력으로 추가 및 변수 및 관측결과 자료 생성
            const facts: EvaluationFacts = {
                push: {
                    contactDetected: observation(true, "NORMAL", [shotId]),
                    severity: observation("CARELESS", "NORMAL", [shotId]),
                    opponentDisplacement: observation("none", "NORMAL", [shotId]),
                    insidePenaltyArea: observation(true, "NORMAL", [shotId]),
                    cameraSufficiency: "HIGH",
                    context: pushContext(true)
                },
                variable: {
                    reviewScenario: "PENALTY_NOT_GIVEN",
                    restartOccurred: false,
                    sendOffCategory: "NONE",
                    mistakenIdentity: false,
                    decisionNature: "SUBJECTIVE",
                    errorMagnitude: "CLEAR_AND_OBVIOUS",
                    seriousMissedIncident: false
                },
                observed: {
                    restartType: "PLAY_CONTINUED",
                    restartBeneficiary: "NONE",
                    card: null,
                    goalDecision: "NOT_APPLICABLE",
                    source: "USER_INPUT"
                }
            };
            // 키 해시 시험용 해시 결과 갱신 결과 해시 결과 준비
            const keyHash = digest("sha256").update("fact-1").digest();
            // 요청해시 시험용 해시 결과 갱신 결과 해시 결과 준비
            const requestHash = digest("sha256").update(JSON.stringify(facts)).digest();
            // 저장소 수정항목 결과를 저장결과에 저장
            const saved = await repository.patch({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                expectedFactRevisionId: null,
                facts,
                keyHash,
                requestHash,
                now: NOW
            });
            // 저장결과 종류의 기대값 생성완료 일치 확인
            expect(saved.kind).toBe("CREATED");
            // 저장결과 종류 비교 조건에 따른 처리 경로 분기
            if (saved.kind !== "CREATED") return;
            // 저장소 수정항목 결과의 종류 지정 문자열 및 사실 개정번호 식별자 자료의 필드 일치 확인
            await expect(
                repository.patch({
                    anonymousSessionId: sessionId,
                    analysisId,
                    candidateId,
                    expectedFactRevisionId: null,
                    facts,
                    keyHash,
                    requestHash,
                    now: NOW
                })
            ).resolves.toMatchObject({ kind: "REPLAYED", factRevisionId: saved.factRevisionId });

            // 저장소 맥락 결과를 맥락에 저장
            const context = await repository.context({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                now: NOW
            });
            // 맥락 종류의 기대값 준비완료 일치 확인
            expect(context.kind).toBe("READY");
            // 맥락 종류 비교 조건에 따른 처리 경로 분기
            if (context.kind !== "READY") return;
            // 맥락 값 대회의 대회 및 시즌 2026 자료 기준 구조 일치 확인
            expect(context.value.competition).toEqual({ competition, season: "2026" });
            // 맥락 값 대회 옵션의 자료 기준 구조 일치 확인
            expect(context.value.competitionOptions).toEqual({});
            // 실행 시험용 평가 결과 준비
            const run = assessment({
                rule: ruleSet,
                competitionRule: competitionSet,
                push: pushResult,
                variable: varResult,
                hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest())
            });
            // 실행 결과를 판정결과에 저장
            const judged = await run({
                ruleVersionId: context.value.ruleVersionId,
                ...(context.value.competition ? { competition: context.value.competition } : {}),
                push: facts.push,
                variable: facts.variable,
                observed: facts.observed,
                options: context.value.competitionOptions
            });
            // 판정결과 종류의 기대값 평가완료 일치 확인
            expect(judged.kind).toBe("EVALUATED");
            // 판정결과 종류 비교 조건에 따른 처리 경로 분기
            if (judged.kind !== "EVALUATED") return;
            // 판정결과 값의 판정 파울 및 재개 페널티킥 및 징계 없음 및 비디오판독평가 자료의 필드 일치 확인
            expect(judged.value).toMatchObject({
                decision: "FOUL",
                restart: "PENALTY_KICK",
                disciplinary: "NONE",
                varAssessment: { intervention: "INTERVENTION_RECOMMENDED" }
            });
            // 영상 샷 조회
            const [shotState] = await database.sql<
                { is_replay: boolean | null }[]
            >`select is_replay from shots where id = ${shotId}`;
            // 샷 상태 재생의 빈 값 확인
            expect(shotState?.is_replay).toBeNull();
            // 인용목록 시험용 판정결과 값 인용목록 필터 결과 준비
            const leagueCitations = judged.value.citations.filter(
                (item) => item.authority === "KLEAGUE"
            );
            // 인용목록 길이의 0 초과 확인
            expect(leagueCitations.length).toBeGreaterThan(0);
            // 인용목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                leagueCitations.every(
                    (item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === "2026"
                )
            ).toBe(true);
            // 저장소 저장 결과를 판정에 저장
            const decision = await repository.save({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                factRevisionId: saved.factRevisionId,
                ruleVersionId: context.value.ruleVersionDbId,
                analysisStateVersion: context.value.analysisStateVersion,
                facts,
                evaluation: judged.value,
                ruleEngineVersion: "rule-engine-v1",
                evaluationSchemaVersion: 1,
                now: NOW
            });
            // 판정 종류의 기대값 생성완료 일치 확인
            expect(decision.kind).toBe("CREATED");
            // 시험 데이터베이스 자료 조회
            const [links] = await database.sql<
                { count: string }[]
            >`select count(*)::text as count from fact_revision_shots where fact_revision_id = ${saved.factRevisionId}`;
            // 규정 판정 결과 조회
            const [citation] = await database.sql<
                { authorities: string[] }[]
            >`select array_agg(item->>'authority') as authorities from decision_results, jsonb_array_elements(citations) item where incident_candidate_id = ${candidateId}`;
            // 링크목록 개수의 기대값 1 일치 확인
            expect(links?.count).toBe("1");
            // 인용의 지정 문자열 포함 확인
            expect(citation?.authorities).toContain("KLEAGUE");
            // 인용의 지정 문자열 포함 확인
            expect(citation?.authorities).toContain("IFAB");
            // 규정 판정 결과 조회
            const [snapshot] = await database.sql<
                { citations: RuleCitation[]; evaluation_snapshot: EvaluationResult }[]
            >`
      select citations, evaluation_snapshot from decision_results where incident_candidate_id = ${candidateId}
    `;
            // 스냅샷 인용목록의 판정결과 값 인용목록 기준 구조 일치 확인
            expect(snapshot?.citations).toEqual(judged.value.citations);
            // 스냅샷 스냅샷의 판정결과 값 기준 구조 일치 확인
            expect(snapshot?.evaluation_snapshot).toEqual(judged.value);
        }
    );

    it.each([
        ["K리그1", "kleague1-2026"],
        ["K리그2", "kleague2-2026"]
    ])(
        "re-evaluates a legacy v1 %s decision without rewriting its history",
        async (competition, versionId) => {
            // 세션 식별자 시험용 무작위식별자 결과 준비
            const sessionId = randomUUID();
            // 영상 식별자 시험용 무작위식별자 결과 준비
            const videoId = randomUUID();
            // 분석 식별자 시험용 무작위식별자 결과 준비
            const analysisId = randomUUID();
            // 후보 식별자 시험용 무작위식별자 결과 준비
            const candidateId = randomUUID();
            // 사실 식별자 시험용 무작위식별자 결과 준비
            const factId = randomUUID();
            // 세션목록 추가 결과 처리 수행
            sessions.push(sessionId);
            // 사실 시험 입력으로 추가 및 변수 및 관측결과 자료 생성
            const facts: EvaluationFacts = {
                push: {
                    contactDetected: observation(false, "NORMAL", []),
                    severity: observation("CARELESS", "NORMAL", []),
                    opponentDisplacement: observation("possible", "NORMAL", []),
                    insidePenaltyArea: observation(false, "NORMAL", []),
                    cameraSufficiency: "HIGH"
                },
                variable: {
                    reviewScenario: "CORNER_KICK_AWARDED",
                    restartOccurred: false,
                    sendOffCategory: "NONE",
                    mistakenIdentity: false,
                    decisionNature: "SUBJECTIVE",
                    errorMagnitude: "CLEAR_AND_OBVIOUS",
                    seriousMissedIncident: false
                },
                observed: {
                    restartType: "CORNER_KICK",
                    restartBeneficiary: "ATTACKING_TEAM",
                    card: "NONE",
                    goalDecision: "NOT_APPLICABLE",
                    source: "USER_INPUT"
                }
            };
            // 익명 세션 삽입
            await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, ${NOW}, ${EXPIRES})
    `;
            // 영상 자산 삽입
            await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([3])}, 'video/mp4', 100, 'VALID', ${competition}, '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
            // 대회 규정 판본 조회
            const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = ${competition} and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
            // 분석 삽입
            await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${NOW}, ${EXPIRES})
    `;
            // 인식 후보 사건 삽입
            await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, camera_sufficiency, review_status)
      values (${candidateId}, ${analysisId}, 1, 'CORNER_KICK_AWARDED', 0, 1800, 'HIGH', 'CONFIRMED')
    `;
            // 사실 개정 기록 삽입
            await database.sql`
      insert into fact_revisions (id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source, created_at)
      values (${factId}, ${analysisId}, ${candidateId}, 1, ${JSON.stringify(facts)}::jsonb, 1, 'USER', ${NOW})
    `;
            // 인식 후보 사건 갱신
            await database.sql`update incident_candidates set current_fact_revision_id = ${factId} where id = ${candidateId}`;
            // 저장소 맥락 결과를 맥락에 저장
            const context = await repository.context({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                now: NOW
            });
            // 맥락 종류 비교 조건에 따른 처리 경로 분기
            if (context.kind !== "READY") throw new Error("context-unavailable");
            // 맥락 값 사실의 사실 기준 구조 일치 확인
            expect(context.value.facts).toEqual(facts);
            // 의존성 시험 입력으로 규정 및 추가 및 변수 및 해시 자료 생성
            const dependencies = {
                rule: ruleSet,
                push: pushResult,
                variable: varResult,
                hash: async (input: string) =>
                    Uint8Array.from(digest("sha256").update(input).digest())
            };
            // 평가 결과를 기존형식에 저장
            const legacy = await assessment(dependencies)({
                ruleVersionId: context.value.ruleVersionId,
                push: context.value.facts.push,
                variable: context.value.facts.variable,
                observed: context.value.facts.observed,
                options: { corner_kick_review: false }
            });
            // 기존형식 종류 비교 조건에 따른 처리 경로 분기
            if (legacy.kind !== "EVALUATED") throw new Error("legacy-evaluation-unavailable");
            // 결과가 대회 선택 규정 미채택 상태로 유지됨 확인
            expect(legacy.value.varAssessment?.notReviewableReason).toBe(
                "COMPETITION_OPTION_NOT_ADOPTED"
            );
            // 저장소 저장 결과를 시험자료에 저장
            const prior = await repository.save({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                factRevisionId: factId,
                ruleVersionId: context.value.ruleVersionDbId,
                analysisStateVersion: context.value.analysisStateVersion,
                facts,
                evaluation: legacy.value,
                ruleEngineVersion: "rule-engine-v1",
                evaluationSchemaVersion: 1,
                now: NOW
            });
            // 시험자료 종류 비교 조건에 따른 처리 경로 분기
            if (prior.kind !== "CREATED") throw new Error("legacy-decision-unavailable");

            // 시점 시험용 날짜 준비
            const reevaluatedAt = new Date(new Date(NOW).getTime() + 1000);
            // 시험자료 시험용 평가 판정 결과 준비
            const decide = evaluateDecision({
                clock: { now: () => reevaluatedAt },
                repository,
                run: assessment({ ...dependencies, competitionRule: competitionSet })
            });
            // 평가 판정 반환값 결과를 시험자료에 저장
            const current = await decide({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId
            });
            // 시험자료 종류의 기대값 생성완료 일치 확인
            expect(current.kind).toBe("CREATED");
            // 시험자료 종류 비교 조건에 따른 처리 경로 분기
            if (current.kind !== "CREATED") return;
            // 시험자료 판정 식별자의 기대값 시험자료 판정 식별자 불일치 확인
            expect(current.decisionId).not.toBe(prior.decisionId);

            // 검증용 이력 조회 구성
            const readHistory = () => database.sql<
                {
                    id: string;
                    incident_candidate_id: string;
                    fact_revision_id: string;
                    applied_rule_version_id: string;
                    fact_signature: string;
                    rule_engine_version: string;
                    citations: RuleCitation[];
                    evaluation_snapshot: EvaluationResult;
                }[]
            >`
      select id, incident_candidate_id, fact_revision_id, applied_rule_version_id,
             encode(fact_signature, 'hex') as fact_signature, rule_engine_version, citations, evaluation_snapshot
      from decision_results where incident_candidate_id = ${candidateId}
      order by rule_engine_version
    `;
            // 읽기 결과를 시험자료에 저장
            const history = await readHistory();
            // 시험자료의 항목 수 2 확인
            expect(history).toHaveLength(2);
            // 시험자료의 각 사례 순회
            for (const item of history) {
                // 항목의 사건 후보 식별자 및 사실 개정번호 식별자 및 규정 버전 식별자 및 사실 서명 자료의 필드 일치 확인
                expect(item).toMatchObject({
                    incident_candidate_id: candidateId,
                    fact_revision_id: factId,
                    applied_rule_version_id: context.value.ruleVersionDbId,
                    fact_signature: legacy.value.factSignature
                });
            }
            // 시험자료 시험용 시험자료 조회 결과 준비
            const previous = history.find((item) => item.id === prior.decisionId);
            // 조회 반환값 규정 버전의 기대값 규정 일치 확인
            expect(previous?.rule_engine_version).toBe("rule-engine-v1");
            // 조회 반환값 인용목록의 기존형식 값 인용목록 기준 구조 일치 확인
            expect(previous?.citations).toEqual(legacy.value.citations);
            // 조회 반환값 스냅샷의 기존형식 값 기준 구조 일치 확인
            expect(previous?.evaluation_snapshot).toEqual(legacy.value);
            // 최신자료 시험용 시험자료 조회 결과 준비
            const latest = history.find((item) => item.id === current.decisionId);
            // 최신자료 규정 버전의 기대값 규정 판정 일치 확인
            expect(latest?.rule_engine_version).toBe("rule-engine-v3-judgment-contract");
            // 최신자료 스냅샷 비디오판독평가 사유의 기대값 지정 문자열 일치 확인
            expect(latest?.evaluation_snapshot.varAssessment?.notReviewableReason).toBe(
                "OUTSIDE_REVIEWABLE_CATEGORIES"
            );
            // 인용목록 시험용 최신자료 인용목록 필터 결과 비교 조건 준비
            const leagueCitations =
                latest?.citations.filter((item) => item.authority === "KLEAGUE") ?? [];
            // 인용목록 길이의 0 초과 확인
            expect(leagueCitations.length).toBeGreaterThan(0);
            // 인용목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                leagueCitations.every(
                    (item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === "2026"
                )
            ).toBe(true);
            // 상태 저장소 결과 분석 결과를 결과에 저장
            const result = await statusStore(database).analysis({
                anonymousSessionId: sessionId,
                analysisId,
                now: reevaluatedAt.toISOString()
            });
            // 결과 후보목록 중 선택 항목 판정 비디오판독평가 사유의 기대값 지정 문자열 일치 확인
            expect(result?.candidates[0]?.judgment?.varAssessment.notReviewableReason).toBe(
                "OUTSIDE_REVIEWABLE_CATEGORIES"
            );
            // 결과 후보목록 중 선택 항목 판정 인용목록의 최신자료 인용목록 기준 구조 일치 확인
            expect(result?.candidates[0]?.judgment?.citations).toEqual(latest?.citations);
            // 평가 판정 반환값 결과의 종류 지정 문자열 및 판정 식별자 자료 기준 구조 일치 확인
            await expect(
                decide({ anonymousSessionId: sessionId, analysisId, candidateId })
            ).resolves.toEqual({
                kind: "REPLAYED",
                decisionId: current.decisionId
            });
            // 읽기 결과의 시험자료 기준 구조 일치 확인
            expect(await readHistory()).toEqual(history);
        }
    );

    it("keeps a newer failed analysis state when a stale evaluation finishes", async () => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 영상 식별자 시험용 무작위식별자 결과 준비
        const videoId = randomUUID();
        // 분석 식별자 시험용 무작위식별자 결과 준비
        const analysisId = randomUUID();
        // 후보 식별자 시험용 무작위식별자 결과 준비
        const candidateId = randomUUID();
        // 사실 식별자 시험용 무작위식별자 결과 준비
        const factId = randomUUID();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 사실 시험 입력으로 추가 및 변수 및 관측결과 자료 생성
        const facts: EvaluationFacts = {
            push: {
                contactDetected: observation(true, "NORMAL", []),
                severity: observation("CARELESS", "NORMAL", []),
                opponentDisplacement: observation("possible", "NORMAL", []),
                insidePenaltyArea: observation(false, "NORMAL", []),
                cameraSufficiency: "HIGH"
            },
            variable: {
                reviewScenario: "GOAL_DISALLOWED",
                restartOccurred: false,
                sendOffCategory: "NONE",
                mistakenIdentity: false,
                decisionNature: "SUBJECTIVE",
                errorMagnitude: "UNDETERMINED",
                seriousMissedIncident: false
            },
            observed: {
                restartType: "DIRECT_FREE_KICK",
                restartBeneficiary: "DEFENDING_TEAM",
                card: null,
                goalDecision: "NO_GOAL",
                source: "USER_INPUT"
            }
        };
        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2026-09-02T00:00:00.000Z', ${EXPIRES})
    `;
        // 영상 자산 삽입
        await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([2])}, 'video/mp4', 100, 'VALID', 'K리그1', '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
        // 대회 규정 판본 조회
        const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = 'K리그1' and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
        // 분석 삽입
        await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, state_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, 0, ${NOW}, ${EXPIRES})
    `;
        // 인식 후보 사건 삽입
        await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, detection_confidence, camera_sufficiency, reasons, shot_indices, review_status)
      values (${candidateId}, ${analysisId}, 1, 'GOAL_DISALLOWED', 0, 1800, .8, 'HIGH', '[]'::jsonb, '[]'::jsonb, 'CONFIRMED')
    `;
        // 사실 개정 기록 삽입
        await database.sql`
      insert into fact_revisions (id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source, created_at)
      values (${factId}, ${analysisId}, ${candidateId}, 1, ${JSON.stringify(facts)}::jsonb, 1, 'USER', ${NOW})
    `;
        // 인식 후보 사건 갱신
        await database.sql`update incident_candidates set current_fact_revision_id = ${factId} where id = ${candidateId}`;
        // 저장소 맥락 결과를 맥락에 저장
        const context = await repository.context({
            anonymousSessionId: sessionId,
            analysisId,
            candidateId,
            now: NOW
        });
        // 맥락 종류의 기대값 준비완료 일치 확인
        expect(context.kind).toBe("READY");
        // 맥락 종류 비교 조건에 따른 처리 경로 분기
        if (context.kind !== "READY") return;
        // 맥락 값 분석상태버전의 기대값 0 일치 확인
        expect(context.value.analysisStateVersion).toBe(0);
        // 분석 갱신
        await database.sql`update analyses set status = 'FAILED', state_version = 1 where id = ${analysisId}`;
        // 실행 시험용 평가 결과 준비
        const run = assessment({
            rule: ruleSet,
            competitionRule: competitionSet,
            push: pushResult,
            variable: varResult,
            hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest())
        });
        // 실행 결과를 판정결과에 저장
        const judged = await run({
            ruleVersionId: context.value.ruleVersionId,
            ...(context.value.competition ? { competition: context.value.competition } : {}),
            push: facts.push,
            variable: facts.variable,
            observed: facts.observed,
            options: context.value.competitionOptions
        });
        // 판정결과 종류의 기대값 평가완료 일치 확인
        expect(judged.kind).toBe("EVALUATED");
        // 판정결과 종류 비교 조건에 따른 처리 경로 분기
        if (judged.kind !== "EVALUATED") return;

        // 오래된 분석 결과 내용을 포함한 기대 결과 일치 확인
        await expect(
            repository.save({
                anonymousSessionId: sessionId,
                analysisId,
                candidateId,
                factRevisionId: factId,
                ruleVersionId: context.value.ruleVersionDbId,
                analysisStateVersion: context.value.analysisStateVersion,
                facts,
                evaluation: judged.value,
                ruleEngineVersion: "rule-engine-v1",
                evaluationSchemaVersion: 1,
                now: NOW
            })
        ).resolves.toMatchObject({ kind: "STALE_ANALYSIS" });

        // 분석 조회
        const [analysis] = await database.sql<
            { status: string; state_version: number }[]
        >`select status, state_version from analyses where id = ${analysisId}`;
        // 처리 실패 내용을 포함한 기대 결과 일치 확인
        expect(analysis).toEqual({ status: "FAILED", state_version: 1 });
    });
});
