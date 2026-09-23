// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    DecisionSaveCommand,
    DecisionSaveResult,
    EvaluationContextCommand,
    EvaluationContextResult,
    EvaluationStore as EvaluationStorePort,
    FactPatchCommand,
    FactPatchResult
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;

// 후보의 사실 판본과 규정 평가 문맥 조회 행 정의
type ContextRow = Readonly<{
    // 분석 기록의 식별자
    analysis_id: string;
    // 동시 변경을 감지하는 분석 상태 버전
    analysis_state_version: number;
    // 사실 또는 평가와 연결할 후보 식별자
    candidate_id: string;
    // 평가에 사용한 사실 판본 식별자
    fact_revision_id: string | null;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: unknown;
    // 적용하거나 인용하는 규정 식별자
    rule_id: string | null;
    // 국제 축구 규정의 판본
    ifab_edition: string | null;
    // 규정 적용 대상 대회
    competition: string | null;
    // 규정 적용 대상 시즌
    season: string | null;
}>;

// 평가 결과 저장소
export class EvaluationStore implements EvaluationStorePort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 사실 수정 이력 저장
    public async patch(command: FactPatchCommand): Promise<FactPatchResult> {
        // 사실 수정 트랜잭션 시작
        return this.client.db.transaction(async (transaction) => {
            // 아직 저장 행이 없는 동일 요청도 세션과 키 단위로 직렬화
            const scope = `${command.anonymousSessionId}:PATCH_FACTS:${Buffer.from(command.keyHash).toString("hex")}`;
            // 동일 멱등 요청 잠금
            await transaction.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`
            );
            // 기존 멱등 기록 조회
            const existingRows = await transaction.execute(sql`
        select request_hash, fact_revision_id
        from idempotency_records
        where anonymous_session_id = ${command.anonymousSessionId}
          and operation = 'PATCH_FACTS'
          and key_hash = ${Buffer.from(command.keyHash)}
        for update
      `);
            // 기존 요청 행 선택
            const [existing] = existingRows as unknown as Array<{
                // 동일 키로 다른 요청을 보냈는지 확인하는 해시
                request_hash: Buffer;
                // 평가에 사용한 사실 판본 식별자
                fact_revision_id: string | null;
            }>;
            // 기존 요청이면 해시와 결과 확인
            if (existing) {
                // 동일 요청 키의 기존 내용과 새 요청 해시 차이 확인
                if (Buffer.compare(existing.request_hash, Buffer.from(command.requestHash)) !== 0) {
                    // 같은 키를 다른 요청에 사용한 충돌 결과 반환
                    return { kind: "IDEMPOTENCY_KEY_REUSED" };
                }
                // 기존 멱등 기록에 사실 판본 연결이 없는 경우 처리 중단
                if (!existing.fact_revision_id) return { kind: "NOT_FOUND" };
                // 기존 사실 이력 조회
                const revisions = await transaction.execute(sql`
          select revision
          from fact_revisions
          where id = ${existing.fact_revision_id}
          limit 1
        `);
                // 기존 사실 이력 반환
                const [revision] = revisions as unknown as Array<{ revision: number }>;
                // 보존된 사실 판본이 있으면 재사용 결과를 반환하고 없으면 부재 반환
                return revision
                    ? {
                          // 처리 분기 또는 자료 종류를 구별하는 값
                          kind: "REPLAYED",
                          // 평가에 사용한 사실 판본 식별자
                          factRevisionId: existing.fact_revision_id,
                          // 변경 이력을 구별하는 판본 번호
                          revision: revision.revision
                      }
                    : { kind: "NOT_FOUND" };
            }

            // 후보 소유권과 현재 사실 이력 조회
            const rows = await transaction.execute(sql`
        select candidate.id, candidate.current_fact_revision_id
        from incident_candidates as candidate
        join analyses as analysis on analysis.id = candidate.analysis_id
        join anonymous_sessions as session on session.id = analysis.anonymous_session_id
        where candidate.id = ${command.candidateId}
          and candidate.analysis_id = ${command.analysisId}
          and analysis.anonymous_session_id = ${command.anonymousSessionId}
          and session.revoked_at is null
          and session.expires_at > ${command.now}
          and analysis.expires_at > ${command.now}
        for update
      `);
            // 후보 행 선택
            const [candidate] = rows as unknown as Array<{
                // 다른 기록과 구별하는 고유 식별자
                id: string;
                // 현재 참조하는 사실 기록 판본 식별자
                current_fact_revision_id: string | null;
            }>;
            // 후보 존재 확인
            if (!candidate) return { kind: "NOT_FOUND" };
            // 낙관적 사실 버전 확인
            if (candidate.current_fact_revision_id !== command.expectedFactRevisionId) {
                // 현재 사실 판본과 예상 판본의 충돌 결과 반환
                return { kind: "STALE_FACT_REVISION" };
            }

            // 다음 사실 이력 번호 조회
            const nextRows = await transaction.execute(sql`
        select coalesce(max(revision), 0) + 1 as revision
        from fact_revisions
        where incident_candidate_id = ${command.candidateId}
      `);
            // 다음 이력 행 선택
            const [next] = nextRows as unknown as Array<{ revision: number }>;
            // 다음 사실 판본 번호 조회 실패 시 저장 중단
            if (!next) throw new Error("fact-revision-sequence-missing");
            // 사실에 연결된 샷 식별자 수집
            const shotIds = [
                ...new Set([
                    ...command.facts.push.contactDetected.shotIds,
                    ...command.facts.push.severity.shotIds,
                    ...command.facts.push.opponentDisplacement.shotIds,
                    ...command.facts.push.insidePenaltyArea.shotIds,
                    ...(
                        [
                            "ballInPlay",
                            "onField",
                            "againstOpponent",
                            "offenderRole",
                            "insideOwnPenaltyArea",
                            "disciplinaryContext"
                        ] as const
                    ).flatMap((key) => command.facts.push.context?.[key]?.shotIds ?? [])
                ])
            ];
            // 연결 샷이 있으면 소유권 확인
            if (shotIds.length > 0) {
                // 화면 구간 식별자를 질의 매개변수 목록으로 변환
                const shotList = sql.join(
                    shotIds.map((shot) => sql`${shot}::uuid`),
                    sql`, `
                );
                // 참조한 화면 구간이 같은 분석에 속하는지 개수 조회
                const shotRows = await transaction.execute(sql`
          select count(*)::int as count
          from shots
          where analysis_id = ${command.analysisId}
            and id in (${shotList})
        `);
                // 연결 샷 개수 확인
                const [shotCount] = shotRows as unknown as Array<{ count: number }>;
                // 모든 참조 화면 구간이 현재 분석에 속하는지 확인
                if (!shotCount || shotCount.count !== shotIds.length) return { kind: "NOT_FOUND" };
            }
            // 사실 이력 저장
            const revisionRows = await transaction.execute(sql`
        insert into fact_revisions (
          analysis_id, incident_candidate_id, revision, facts, fact_schema_version,
          source, extraction_confidence, model_version, created_at
        ) values (
          ${command.analysisId}, ${command.candidateId}, ${next.revision},
          ${JSON.stringify(command.facts)}::jsonb, 2, 'USER', null, null, ${command.now}
        )
        returning id, revision
      `);
            // 저장된 사실 이력 선택
            const [revision] = revisionRows as unknown as Array<{ id: string; revision: number }>;
            // 새 사실 판본 저장 결과가 없으면 오류 처리
            if (!revision) throw new Error("fact-revision-insert-missing");

            // 연결할 화면 구간이 있을 때만 관계 기록 저장
            if (shotIds.length > 0) {
                // 사실 이력과 샷 연결 저장
                const shotList = sql.join(
                    shotIds.map((shot) => sql`${shot}::uuid`),
                    sql`, `
                );
                // 새 사실 판본과 같은 분석의 화면 구간 관계 저장
                await transaction.execute(sql`
          insert into fact_revision_shots (fact_revision_id, shot_id, analysis_id)
          select ${revision.id}, shot.id, ${command.analysisId}
          from shots as shot
          where shot.analysis_id = ${command.analysisId}
            and shot.id in (${shotList})
        `);
            }

            // 후보의 현재 사실 이력 갱신
            await transaction.execute(sql`
        update incident_candidates
        set current_fact_revision_id = ${revision.id}, review_status = 'CONFIRMED'
        where id = ${command.candidateId}
          and analysis_id = ${command.analysisId}
      `);
            // 사실 변경 전 판정은 이력으로 남기고 분석을 재평가 대기로 전환
            // 멱등 기록 저장
            await transaction.execute(sql`
        update analyses
        set status = 'CANDIDATES_READY', completed_at = null, state_version = state_version + 1
        where id = ${command.analysisId} and status in ('CANDIDATES_READY', 'COMPLETED')
      `);
            // 동일 사실 수정 요청의 중복 실행 방지를 위한 멱등 기록 저장
            await transaction.execute(sql`
        insert into idempotency_records (
          anonymous_session_id, operation, key_hash, request_hash,
          analysis_id, incident_candidate_id, fact_revision_id, created_at, expires_at
        ) values (
          ${command.anonymousSessionId}, 'PATCH_FACTS', ${Buffer.from(command.keyHash)},
          ${Buffer.from(command.requestHash)}, ${command.analysisId}, ${command.candidateId},
          ${revision.id}, ${command.now}, ${command.now}::timestamptz + interval '24 hours'
        )
      `);
            // 사실 수정 결과 반환
            return { kind: "CREATED", factRevisionId: revision.id, revision: revision.revision };
        });
    }

    // 평가에 필요한 경기 문맥 조회
    public async context(command: EvaluationContextCommand): Promise<EvaluationContextResult> {
        // 평가 문맥 조회
        const rows = await this.client.db.execute(sql`
      select analysis.id as analysis_id,
             analysis.state_version as analysis_state_version,
             candidate.id as candidate_id,
             candidate.current_fact_revision_id as fact_revision_id,
             fact.facts,
             version.id as rule_id,
             version.ifab_edition,
             version.competition,
             version.season
      from analyses as analysis
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      join incident_candidates as candidate on candidate.analysis_id = analysis.id
      left join fact_revisions as fact on fact.id = candidate.current_fact_revision_id
      left join competition_rule_versions as version on version.id = analysis.applied_rule_version_id
      where analysis.id = ${command.analysisId}
        and candidate.id = ${command.candidateId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and analysis.expires_at > ${command.now}
      limit 1
    `);
        // 평가 문맥 행 선택
        const [row] = rows as unknown as ContextRow[];
        // 분석과 후보 존재 확인
        if (!row) return { kind: "NOT_FOUND" };
        // 사실 이력 존재 확인
        if (!row.fact_revision_id || !row.facts) return { kind: "NO_FACTS" };
        // 국제축구평의회 규정 판본 존재 확인
        if (!row.rule_id || !row.ifab_edition) return { kind: "RULE_VERSION_UNAVAILABLE" };
        // 대회 규정 정보 존재 확인
        if (!row.competition || !row.season) return { kind: "RULE_VERSION_UNAVAILABLE" };
        // 규정 엔진 입력 반환
        return {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "READY",
            // 해당 계약이 전달하는 값
            value: {
                // 분석 기록의 식별자
                analysisId: row.analysis_id,
                // 동시 변경을 감지하는 분석 상태 버전
                analysisStateVersion: row.analysis_state_version,
                // 사실 또는 평가와 연결할 후보 식별자
                candidateId: row.candidate_id,
                // 평가에 사용한 사실 판본 식별자
                factRevisionId: row.fact_revision_id,
                // 확인된 출처와 판본을 보존하는 규정 사실 자료
                facts: row.facts as import("@replay/shared-types").EvaluationFacts,
                // 대회 규정 판본 식별자
                ruleVersionId: `ifab-${row.ifab_edition}`,
                // 저장소에서 규정 판본을 찾는 식별자
                ruleVersionDbId: row.rule_id,
                // 규정 적용 대상 대회
                competition: { competition: row.competition, season: row.season },
                // 검증된 대회와 시즌의 규정 선택 자료
                competitionOptions: {}
            }
        };
    }

    // 판정 결과와 출처 저장
    public async save(command: DecisionSaveCommand): Promise<DecisionSaveResult> {
        // 판정 결과 저장
        const assessment = command.evaluation.varAssessment;
        // 저장 가능한 평가 결과가 없으면 실패 처리
        if (!assessment) throw new Error("var-assessment-missing");
        // 최신 후보 확인과 평가 저장을 하나의 트랜잭션으로 실행한 결과 반환
        return this.client.db.transaction(async (transaction) => {
            // 후보 최신 상태 잠금 조회
            const owned = await transaction.execute(sql`
        select candidate.id, candidate.current_fact_revision_id,
               analysis.state_version, analysis.status
        from incident_candidates as candidate
        join analyses as analysis on analysis.id = candidate.analysis_id
        join anonymous_sessions as session on session.id = analysis.anonymous_session_id
        where candidate.id = ${command.candidateId}
          and candidate.analysis_id = ${command.analysisId}
          and analysis.anonymous_session_id = ${command.anonymousSessionId}
          and analysis.applied_rule_version_id = ${command.ruleVersionId}
          and session.revoked_at is null
          and session.expires_at > ${command.now}
          and analysis.expires_at > ${command.now}
        limit 1
        for update
      `);
            // 후보 상태 행 선택
            const [candidate] = owned as unknown as Array<{
                // 다른 기록과 구별하는 고유 식별자
                id: string;
                // 현재 참조하는 사실 기록 판본 식별자
                current_fact_revision_id: string | null;
                // 동시 변경 충돌을 감지하는 상태 버전
                state_version: number;
                // 처리 상태 또는 요청 응답 상태
                status: string;
            }>;
            // 후보가 없으면 저장 중단
            if (!candidate) return { kind: "NOT_FOUND" };
            // 잠금 이후에도 현재 사실과 분석 상태가 평가 시작 시점과 같은지 확인
            if (candidate.current_fact_revision_id !== command.factRevisionId)
                // 저장 직전 사실 판본 변경 충돌 반환
                return { kind: "STALE_FACT_REVISION" };
            // 분석 상태 버전과 평가 가능한 처리 상태 재확인
            if (
                candidate.state_version !== command.analysisStateVersion ||
                !["CANDIDATES_READY", "COMPLETED"].includes(candidate.status)
            ) {
                // 분석 변경으로 인한 오래된 평가 저장 거부 반환
                return { kind: "STALE_ANALYSIS" };
            }
            // 사실 이력 존재 확인
            const factRows = await transaction.execute(sql`
        select id
        from fact_revisions
        where id = ${command.factRevisionId}
          and incident_candidate_id = ${command.candidateId}
          and analysis_id = ${command.analysisId}
        limit 1
      `);
            // 사실 이력이 없으면 저장 중단
            if (factRows.length === 0) return { kind: "FACT_NOT_FOUND" };

            // 판정 결과 저장
            const inserted = await transaction.execute(sql`
        insert into decision_results (
          analysis_id, incident_candidate_id, fact_revision_id, applied_rule_version_id,
          observed_restart_type, observed_restart_beneficiary, observed_card,
          observed_goal_decision, observed_source, foul_decision, severity, goal_decision,
          restart_type, disciplinary_action, decision_match, var_reviewable, var_category,
          var_within_time_window, var_threshold_met, var_intervention, var_no_intervention_reason,
          var_not_reviewable_reason, var_window_closed_reason, var_window_exception,
          var_review_procedure, judgment_confidence_level, inconclusive_reason, fact_signature,
          rule_engine_version, evaluation_schema_version, evaluation_snapshot, citations, created_at
        ) values (
          ${command.analysisId}, ${command.candidateId}, ${command.factRevisionId}, ${command.ruleVersionId},
          ${command.facts.observed.restartType}::observed_restart_type,
          ${command.facts.observed.restartBeneficiary}::observed_restart_beneficiary,
          ${command.facts.observed.card}::disciplinary_action,
          ${command.facts.observed.goalDecision}::observed_goal_decision,
          ${command.facts.observed.source}::observed_source,
          ${command.evaluation.decision}::foul_decision,
          ${command.evaluation.severity}::severity,
          null,
          ${command.evaluation.restart}::observed_restart_type,
          ${command.evaluation.disciplinary}::disciplinary_action,
          ${command.evaluation.decisionMatch}::decision_match,
          ${assessment.reviewable}, ${assessment.category}::var_category,
          ${assessment.withinTimeWindow}, ${assessment.thresholdMet}::var_threshold_result,
          ${assessment.intervention}::var_intervention,
          ${assessment.noInterventionReason}::var_no_intervention_reason,
          ${assessment.notReviewableReason}::var_not_reviewable_reason,
          ${assessment.windowClosedReason}::var_window_closed_reason,
          ${assessment.windowException}::var_window_exception,
          ${assessment.reviewProcedure}::var_review_procedure,
          ${command.evaluation.confidence},
          ${command.evaluation.inconclusiveReason}::inconclusive_reason,
          ${Buffer.from(command.evaluation.factSignature, "hex")},
          ${command.ruleEngineVersion}, ${command.evaluationSchemaVersion},
          ${JSON.stringify(command.evaluation)}::jsonb,
          ${JSON.stringify(command.evaluation.citations)}::jsonb, ${command.now}
        )
        on conflict (incident_candidate_id, fact_revision_id, applied_rule_version_id, rule_engine_version)
        do nothing
        returning id
      `);
            // 저장된 판정 행 선택
            const [row] = inserted as unknown as Array<{ id: string }>;
            // 기존에 저장한 평가 행이 있으면 해당 결과 재사용
            if (row) {
                // 모든 최신 후보가 평가되면 분석 완료
                await transaction.execute(sql`
          update analyses as analysis
          set status = 'COMPLETED', completed_at = ${command.now}, state_version = analysis.state_version + 1
          where analysis.id = ${command.analysisId}
            and analysis.status = 'CANDIDATES_READY'
            and analysis.state_version = ${command.analysisStateVersion}
            and not exists (
              select 1
              from incident_candidates as pending
              where pending.analysis_id = analysis.id
                and not exists (
                  select 1 from decision_results as result
                  where result.incident_candidate_id = pending.id
                    and result.analysis_id = analysis.id
                    and result.fact_revision_id = pending.current_fact_revision_id
                    and result.applied_rule_version_id = analysis.applied_rule_version_id
                )
            )
        `);
                // 신규 판정 결과 반환
                return { kind: "CREATED", decisionId: row.id };
            }
            // 동일 판정 결과 조회
            const existing = await transaction.execute(sql`
        select id
        from decision_results
        where incident_candidate_id = ${command.candidateId}
          and fact_revision_id = ${command.factRevisionId}
          and applied_rule_version_id = ${command.ruleVersionId}
          and rule_engine_version = ${command.ruleEngineVersion}
        limit 1
      `);
            // 기존 판정 행 선택
            const [saved] = existing as unknown as Array<{ id: string }>;
            // 재생 결과 또는 저장 실패 반환
            return saved ? { kind: "REPLAYED", decisionId: saved.id } : { kind: "NOT_FOUND" };
        });
    }
}

// 저장소 접근 구성
export const evaluationStore = (client: DatabaseHandle): EvaluationStore =>
    new EvaluationStore(client);
