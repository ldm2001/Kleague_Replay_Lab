import { sql } from "drizzle-orm";
import type {
  DecisionSaveCommand,
  DecisionSaveResult,
  EvaluationContextCommand,
  EvaluationContextResult,
  EvaluationStore as EvaluationStorePort,
  FactPatchCommand,
  FactPatchResult,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type ContextRow = Readonly<{
  analysis_id: string;
  analysis_state_version: number;
  candidate_id: string;
  fact_revision_id: string | null;
  facts: unknown;
  rule_id: string | null;
  ifab_edition: string | null;
  competition: string | null;
  season: string | null;
}>;

const options = Object.freeze({ corner_kick_review: false });

// 평가 결과 저장소
export class EvaluationStore implements EvaluationStorePort {
  public constructor(private readonly client: DatabaseHandle) {}

  public async patch(command: FactPatchCommand): Promise<FactPatchResult> {
    // 사실 수정 트랜잭션 시작
    return this.client.db.transaction(async (transaction) => {
      // 아직 저장 행이 없는 동일 요청도 세션과 키 단위로 직렬화
      const scope = `${command.anonymousSessionId}:PATCH_FACTS:${Buffer.from(command.keyHash).toString("hex")}`;
      // 동일 멱등 요청 잠금
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
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
      const [existing] = existingRows as unknown as Array<{ request_hash: Buffer; fact_revision_id: string | null }>;
      // 기존 요청이면 해시와 결과 확인
      if (existing) {
        if (Buffer.compare(existing.request_hash, Buffer.from(command.requestHash)) !== 0) {
          return { kind: "IDEMPOTENCY_KEY_REUSED" };
        }
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
        return revision
          ? { kind: "REPLAYED", factRevisionId: existing.fact_revision_id, revision: revision.revision }
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
      const [candidate] = rows as unknown as Array<{ id: string; current_fact_revision_id: string | null }>;
      // 후보 존재 확인
      if (!candidate) return { kind: "NOT_FOUND" };
      // 낙관적 사실 버전 확인
      if (candidate.current_fact_revision_id !== command.expectedFactRevisionId) {
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
      if (!next) throw new Error("fact-revision-sequence-missing");
      // 사실에 연결된 샷 식별자 수집
      const shotIds = [...new Set([
        ...command.facts.push.contactDetected.shotIds,
        ...command.facts.push.severity.shotIds,
        ...command.facts.push.opponentDisplacement.shotIds,
        ...command.facts.push.insidePenaltyArea.shotIds,
      ])];
      // 연결 샷이 있으면 소유권 확인
      if (shotIds.length > 0) {
        const shotList = sql.join(shotIds.map((shot) => sql`${shot}::uuid`), sql`, `);
        const shotRows = await transaction.execute(sql`
          select count(*)::int as count
          from shots
          where analysis_id = ${command.analysisId}
            and id in (${shotList})
        `);
        // 연결 샷 개수 확인
        const [shotCount] = shotRows as unknown as Array<{ count: number }>;
        if (!shotCount || shotCount.count !== shotIds.length) return { kind: "NOT_FOUND" };
      }
      // 사실 이력 저장
      const revisionRows = await transaction.execute(sql`
        insert into fact_revisions (
          analysis_id, incident_candidate_id, revision, facts, fact_schema_version,
          source, extraction_confidence, model_version, created_at
        ) values (
          ${command.analysisId}, ${command.candidateId}, ${next.revision},
          ${JSON.stringify(command.facts)}::jsonb, 1, 'USER', null, null, ${command.now}
        )
        returning id, revision
      `);
      // 저장된 사실 이력 선택
      const [revision] = revisionRows as unknown as Array<{ id: string; revision: number }>;
      if (!revision) throw new Error("fact-revision-insert-missing");

      if (shotIds.length > 0) {
        // 사실 이력과 샷 연결 저장
        const shotList = sql.join(shotIds.map((shot) => sql`${shot}::uuid`), sql`, `);
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
    // IFAB 규정 판본 존재 확인
    if (!row.rule_id || !row.ifab_edition) return { kind: "RULE_VERSION_UNAVAILABLE" };
    // 대회 규정 정보 존재 확인
    if (!row.competition || !row.season) return { kind: "RULE_VERSION_UNAVAILABLE" };
    // 규정 엔진 입력 반환
    return {
      kind: "READY",
      value: {
        analysisId: row.analysis_id,
        analysisStateVersion: row.analysis_state_version,
        candidateId: row.candidate_id,
        factRevisionId: row.fact_revision_id,
        facts: row.facts as import("@replay/shared-types").EvaluationFacts,
        ruleVersionId: `ifab-${row.ifab_edition}`,
        ruleVersionDbId: row.rule_id,
        competitionOptions: options,
      },
    };
  }

  public async save(command: DecisionSaveCommand): Promise<DecisionSaveResult> {
    // 판정 결과 저장
    const assessment = command.evaluation.varAssessment;
    if (!assessment) throw new Error("var-assessment-missing");
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
      const [candidate] = owned as unknown as Array<{ id: string; current_fact_revision_id: string | null; state_version: number; status: string }>;
      // 후보가 없으면 저장 중단
      if (!candidate) return { kind: "NOT_FOUND" };
      // 잠금 이후에도 현재 사실과 분석 상태가 평가 시작 시점과 같은지 확인
      if (candidate.current_fact_revision_id !== command.factRevisionId) return { kind: "STALE_FACT_REVISION" };
      if (candidate.state_version !== command.analysisStateVersion || !["CANDIDATES_READY", "COMPLETED"].includes(candidate.status)) {
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

      // 최신 K리그 규정 인용 조회
      const kleagueRows = await transaction.execute(sql`
        select authority, edition, law, section, concept, revision, content_sha256,
               coalesce(official_korean, plain_korean, original_text) as quote_snapshot,
               source_page, source_url, review_status
        from rules
        where authority = 'KLEAGUE'
          and edition = '2026'
          and concept = 'VAR_REVIEWABLE_CATEGORIES'
        order by revision desc, id desc
        limit 1
      `);
      // K리그 인용 행 선택
      const [kleague] = kleagueRows as unknown as Array<{
        authority: "KLEAGUE";
        edition: string;
        law: string;
        section: string;
        concept: string;
        revision: number;
        content_sha256: Buffer;
        quote_snapshot: string | null;
        source_page: string | null;
        source_url: string | null;
        review_status: string;
      }>;
      // IFAB 인용에 K리그 인용 추가
      const citations = kleague && kleague.quote_snapshot
        ? [...command.evaluation.citations, {
            ruleId: `kleague-${kleague.edition}-${kleague.law}-${kleague.section}-${kleague.concept}`,
            ruleRevision: kleague.revision,
            ruleContentSha256: kleague.content_sha256.toString("hex"),
            authority: kleague.authority,
            edition: kleague.edition,
            law: kleague.law,
            section: kleague.section,
            relevance: "SUPPORTING" as const,
            quoteSnapshot: kleague.quote_snapshot,
            sourcePage: kleague.source_page,
            sourceUrl: kleague.source_url,
          }]
        : command.evaluation.citations;
      const evaluation = { ...command.evaluation, citations };

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
          ${JSON.stringify(evaluation)}::jsonb,
          ${JSON.stringify(citations)}::jsonb, ${command.now}
        )
        on conflict (incident_candidate_id, fact_revision_id, applied_rule_version_id, rule_engine_version)
        do nothing
        returning id
      `);
      // 저장된 판정 행 선택
      const [row] = inserted as unknown as Array<{ id: string }>;
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

export const evaluationStore = (client: DatabaseHandle): EvaluationStore => new EvaluationStore(client);
