import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { report } from "@replay/application";
import { observation, type PushFacts } from "@replay/shared-types";
import { automaticReview } from "../../src/application/use-cases/evaluation/automatic";
import { perceptionPayload } from "../fixtures/perception";
import { context as pushContext } from "../fixtures/push-context";
import { judgment } from "../fixtures/result";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("automatic source context", () => {
    // 데이터베이스 주소 부정 조건에 따른 처리 경로 분기
    if (!databaseUrl) return;
    // 데이터베이스 시험용 클라이언트 결과 준비
    const database = client(databaseUrl);
    afterAll(() => database.close());
    it("links exact known match and only a unique independently verified sourced edition", async () => {
        // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID(),
            videoId = randomUUID(),
            analysisId = randomUUID(),
            jobId = randomUUID();
        // 시험자료 및 시험자료 및 경기 및 시험자료 시험용 무작위식별자 결과 준비
        const home = randomUUID(),
            away = randomUUID(),
            match = randomUUID(),
            duplicate = randomUUID();
        // 대회 규정 판본 조회
        const [existingRule] =
            await database.sql`select id, verification_status, source_document from competition_rule_versions
      where competition = 'K리그2' and season = '2026' and effective_from = '2026-07-01'`;
        // 규정 시험용 규정 식별자 준비
        const rule = existingRule!.id;
        // 원본 및 임대 시험용 바이트버퍼 변환 결과 준비
        const source = Buffer.from(
                "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857",
                "hex"
            ),
            lease = randomBytes(32);
        // 현재시각 및 만료시각 시험용 2030 01 00 00 준비
        const now = "2030-01-01T00:00:00.000Z",
            expires = "2030-01-02T00:00:00.000Z";
        try {
            // 구단 삽입
            await database.sql`insert into clubs(id, canonical_name, short_code) values (${home}, '충북청주', ${home.slice(0, 8)}), (${away}, '수원', ${away.slice(0, 8)})`;
            // 경기 삽입
            await database.sql`insert into matches(id, competition, season, match_date, home_club_id, away_club_id, score_home, score_away)
        values (${match}, 'K리그2', '2026', '2026-08-01', ${home}, ${away}, 2, 2), (${duplicate}, 'K리그2', '2026', '2026-08-01', ${home}, ${away}, 2, 2)`;
            // 익명 세션 삽입
            await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at) values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
            // 영상 자산 삽입
            await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
            // 분석 삽입
            await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class, source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source}, 'video-local-observers-v1', 'media-v1', ${now}, ${expires})`;
            // 영상 처리 작업 삽입
            await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'worker', ${lease}, ${expires}, ${now}, ${now})`;
            // 저장소 시험용 작업 저장소 준비
            const store = new JobStore(database, () => new Date(now));
            // 명령 시험 입력으로 작업 식별자 및 작업자 식별자 작업자 및 작업 개정번호 1 및 임대 토큰 해시 자료 생성
            const command = {
                jobId,
                workerId: "worker",
                jobRevision: 1,
                leaseTokenHash: lease,
                now
            };
            // 저장소 사전점검 결과의 종류 지정 문자열 및 규정 판본 빈 값 자료의 필드 일치 확인
            expect(await store.preflight(command)).toMatchObject({
                kind: "AUTHORIZED",
                // 경기와 연결된 규정 판본의 검증 맥락 구성
                ruleEdition: null
            });
            // 분석 조회 결과의 경기 연결이 비어 있음 확인
            expect(
                (await database.sql`select match_id from analyses where id = ${analysisId}`)[0]
                    ?.match_id
            ).toBeNull();
            // 경기 삭제
            await database.sql`delete from matches where id = ${duplicate}`;
            // 저장소 사전점검 결과의 종류 지정 문자열 및 규정 판본 빈 값 자료의 필드 일치 확인
            expect(await store.preflight(command)).toMatchObject({
                kind: "AUTHORIZED",
                // 경기와 연결된 규정 판본의 검증 맥락 구성
                ruleEdition: null
            });
            // 분석 조회 결과의 경기 연결과 적용 규정 연결 상태 확인
            expect(
                (
                    await database.sql`select match_id, applied_rule_version_id from analyses where id = ${analysisId}`
                )[0]
            ).toMatchObject({ match_id: match, applied_rule_version_id: null });
            // 분석 갱신
            await database.sql`update analyses set match_id = null where id = ${analysisId}`;
            // 대회 규정 판본 갱신
            await database.sql`update competition_rule_versions set verification_status = 'VERIFIED', source_document = 'https://example.test/verified-adoption' where id = ${rule}`;
            // 저장소 사전점검 결과의 종류 지정 문자열 및 규정 판본 자료의 필드 일치 확인
            expect(await store.preflight(command)).toMatchObject({
                kind: "AUTHORIZED",
                // 경기와 연결된 규정 판본의 검증 맥락 구성
                ruleEdition: { id: rule, matchId: match, competition: "K리그2", season: "2026" }
            });

            // 합성 시험 전용 생산자이며 운영 승인 목록은 미지원 유지
            const producer = {
                methodId: "TESTONLY-pushing-db",
                version: "1",
                validationReportSha256: "d".repeat(64)
            };
            // 사실 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
            const facts: PushFacts = {
                contactDetected: observation(true, "NORMAL", []),
                severity: observation("CARELESS", "NORMAL", []),
                opponentDisplacement: observation("none", "NORMAL", []),
                insidePenaltyArea: observation(false, "NORMAL", []),
                cameraSufficiency: "HIGH",
                context: pushContext()
            };
            // 원본 시험용 인식전송자료 결과 준비
            const original = perceptionPayload();
            // 근거 시험 입력으로 기존 항목 및 종류 및 시작시각 500 및 종료시각 1500 자료 생성
            const evidence = {
                ...original.evidence![0]!,
                kind: "CLIP" as const,
                startMs: 500,
                endMs: 1500,
                objectKey: `evidence/${analysisId}/${jobId}/1/${original.evidence![0]!.contentSha256}/clip.mp4`
            };
            // 전송자료 시험 입력으로 기존 항목 및 근거 및 인식 자료 생성
            const payload = {
                ...original,
                evidence: [evidence],
                perception: {
                    ...original.perception!,
                    sourceSha256: source.toString("hex"),
                    artifact: {
                        ...original.perception!.artifact,
                        objectKey: `perception/${analysisId}/${jobId}/1/${original.perception!.artifact.contentSha256}.jsonl.gz`
                    }
                }
            };
            // 자동평가 시험용 자동규정평가 결과 준비
            const automatic = automaticReview(
                {
                    analysisId,
                    jobId,
                    jobRevision: 1,
                    sourceSha256: source.toString("hex"),
                    durationMs: 2000,
                    pipelineVersion: payload.pipelineVersion,
                    perception: payload.perception,
                    candidates: payload.candidates,
                    // 후보별 근거 위치와 내용 해시를 대조할 참조 목록 구성
                    references: [{ ...evidence, evidenceIndex: 0, immutable: true }],
                    rule: {
                        id: rule,
                        matchId: match,
                        competition: "K리그2",
                        season: "2026",
                        ifabVersionId: "ifab-2026-27",
                        // 해당 자료의 검증 완료 상태이며 모든 인식 사실의 승인을 뜻하지 않음
                        verificationStatus: "VERIFIED"
                    }
                },
                {
                    registry: [producer],
                    produce: () => ({ kind: "READY", producer, facts, evidenceIndices: [0] })
                }
            );
            // 자동평가 행목록 중 선택 항목 결과 판정의 기대값 파울 일치 확인
            expect(automatic.rows[0]?.result?.decision).toBe("FOUL");
            // 관측이나 처리 실패의 저장 접수 성공이며 파울 판정 승인과 별개임 확인
            expect(
                await store.result({
                    ...command,
                    payload,
                    automaticReview: automatic,
                    perceptionVerification: {
                        analysisId,
                        sourceSha256: source,
                        admission: { status: "NOT_ADMITTED", reasons: ["TESTONLY"] }
                    }
                })
            ).toEqual({ kind: "ACCEPTED" });
            // 시험자료 시험용 상태 저장소 준비
            const reader = new StatusStore(database);
            // 읽기 시험용 보고서 결과 준비
            const read = report({ repository: reader, clock: { now: () => new Date(now) } });
            // 읽기 결과를 공개값에 저장
            const published = await read({ analysisId, anonymousSessionId: sessionId });
            // 응답본문 직렬화 결과의 사실 서명 입력 미포함 확인
            expect(JSON.stringify(published)).not.toContain("factSignatureInput");
            // 응답본문 직렬화 결과의 자동평가 요약 미포함 확인
            expect(JSON.stringify(published)).not.toContain("automaticReviewSummary");
            // 공개값의 평가완료 개수 1 및 완료 적용범위 개수 0 및 판정 상태 부분 및 후보목록 자료의 필드 일치 확인
            expect(published).toMatchObject({
                evaluatedCount: 1,
                completedScopeCount: 0,
                judgmentStatus: "PARTIAL",
                candidates: [
                    {
                        automaticJudgment: { result: { decision: "FOUL" }, producer },
                        judgment: null
                    }
                ]
            });
            // 조회한 사건 후보의 식별자 읽음
            const candidate = (
                await database.sql`select id from incident_candidates where analysis_id = ${analysisId}`
            )[0]!.id;
            // 개정번호 시험용 무작위식별자 결과 준비
            const revision = randomUUID();
            // 사실 개정 기록 삽입
            await database.sql`insert into fact_revisions(id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source)
        values (${revision}, ${analysisId}, ${candidate}, 1, ${JSON.stringify(judgment.facts)}::jsonb, 1, 'USER')`;
            // 인식 후보 사건 갱신
            await database.sql`update incident_candidates set current_fact_revision_id = ${revision} where id = ${candidate}`;
            // 규정 판정 결과 삽입
            await database.sql`insert into decision_results(analysis_id, incident_candidate_id, fact_revision_id, applied_rule_version_id,
        observed_restart_type, observed_restart_beneficiary, observed_goal_decision, observed_source,
        foul_decision, restart_type, disciplinary_action, decision_match, var_reviewable, var_category, var_within_time_window,
        var_threshold_met, var_intervention, var_window_exception, var_review_procedure, judgment_confidence_level,
        fact_signature, rule_engine_version, evaluation_schema_version, evaluation_snapshot, citations)
        values (${analysisId}, ${candidate}, ${revision}, ${rule}, 'PLAY_CONTINUED', 'NONE', 'NOT_APPLICABLE', 'USER_INPUT',
        'NO_FOUL', 'PLAY_CONTINUED', 'NONE', 'UNDETERMINED', false, 'NONE', false, 'UNDETERMINED', 'NO_INTERVENTION', 'NONE', 'NONE', 'HIGH',
        ${randomBytes(32)}, 'legacy-test', 1, '{}'::jsonb, ${JSON.stringify(judgment.citations)}::jsonb)`;
            // 결과가 파울 아님 상태로 유지됨 확인
            expect(
                (await reader.analysis({ analysisId, anonymousSessionId: sessionId, now }))
                    ?.candidates[0]?.judgment?.decision
            ).toBe("NO_FOUL");
            // 읽기 결과의 평가완료 개수 1 및 후보목록 자료의 필드 일치 확인
            expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({
                evaluatedCount: 1,
                candidates: [
                    { automaticJudgment: { result: { decision: "FOUL" } }, judgment: null }
                ]
            });
            // 근거 자산 갱신
            await database.sql`update evidence_assets set object_deleted_at = ${now} where analysis_id = ${analysisId}`;
            // 읽기 결과의 평가완료 개수 0 및 후보목록 자료의 필드 일치 확인
            expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({
                evaluatedCount: 0,
                candidates: []
            });
            // 근거 자산 갱신
            await database.sql`update evidence_assets set object_deleted_at = null where analysis_id = ${analysisId}`;
            // 대회 규정 판본 갱신
            await database.sql`update competition_rule_versions set verification_status = 'UNVERIFIED' where id = ${rule}`;
            // 읽기 결과의 평가완료 개수 0 및 후보목록 자료의 필드 일치 확인
            expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({
                evaluatedCount: 0,
                candidates: []
            });
            // 대회 규정 판본 갱신
            await database.sql`update competition_rule_versions set verification_status = 'VERIFIED' where id = ${rule}`;
            // 분석 갱신
            await database.sql`update analyses set source_fingerprint = ${randomBytes(32)} where id = ${analysisId}`;
            // 읽기 결과의 평가완료 개수 0 및 후보목록 자료의 필드 일치 확인
            expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({
                evaluatedCount: 0,
                candidates: []
            });
        } finally {
            // 분석 인식 실행 기록 삭제
            await database.sql`delete from analysis_perception_runs where analysis_id = ${analysisId}`;
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
            // 대회 규정 판본 갱신
            await database.sql`update competition_rule_versions set verification_status = ${existingRule!.verification_status}, source_document = ${existingRule!.source_document} where id = ${rule}`;
            // 경기 삭제
            await database.sql`delete from matches where id in (${match}, ${duplicate})`;
            // 구단 삭제
            await database.sql`delete from clubs where id in (${home}, ${away})`;
        }
    });
});
