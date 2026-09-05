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
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
      const existingRows = await transaction.execute(sql`
        select request_hash, fact_revision_id
        from idempotency_records
        where anonymous_session_id = ${command.anonymousSessionId}
          and operation = 'PATCH_FACTS'
          and key_hash = ${Buffer.from(command.keyHash)}
        for update
      `);
      const [existing] = existingRows as unknown as Array<{ request_hash: Buffer; fact_revision_id: string | null }>;
      if (existing) {
        if (Buffer.compare(existing.request_hash, Buffer.from(command.requestHash)) !== 0) {
          return { kind: "IDEMPOTENCY_KEY_REUSED" };
        }
        if (!existing.fact_revision_id) return { kind: "NOT_FOUND" };
        const revisions = await transaction.execute(sql`
          select revision
          from fact_revisions
          where id = ${existing.fact_revision_id}
          limit 1
        `);
        const [revision] = revisions as unknown as Array<{ revision: number }>;
        return revision
          ? { kind: "REPLAYED", factRevisionId: existing.fact_revision_id, revision: revision.revision }
          : { kind: "NOT_FOUND" };
      }

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
      const [candidate] = rows as unknown as Array<{ id: string; current_fact_revision_id: string | null }>;
      if (!candidate) return { kind: "NOT_FOUND" };
      if (candidate.current_fact_revision_id !== command.expectedFactRevisionId) {
        return { kind: "STALE_FACT_REVISION" };
      }

      const nextRows = await transaction.execute(sql`
        select coalesce(max(revision), 0) + 1 as revision
        from fact_revisions
        where incident_candidate_id = ${command.candidateId}
      `);
      const [next] = nextRows as unknown as Array<{ revision: number }>;
      if (!next) throw new Error("fact-revision-sequence-missing");
      const shotIds = [...new Set([
        ...command.facts.push.contactDetected.shotIds,
        ...command.facts.push.severity.shotIds,
        ...command.facts.push.opponentDisplacement.shotIds,
        ...command.facts.push.insidePenaltyArea.shotIds,
      ])];
      if (shotIds.length > 0) {
        const shotList = sql.join(shotIds.map((shot) => sql`${shot}::uuid`), sql`, `);
        const shotRows = await transaction.execute(sql`
          select count(*)::int as count
          from shots
          where analysis_id = ${command.analysisId}
            and id in (${shotList})
        `);
        const [shotCount] = shotRows as unknown as Array<{ count: number }>;
        if (!shotCount || shotCount.count !== shotIds.length) return { kind: "NOT_FOUND" };
      }
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
      const [revision] = revisionRows as unknown as Array<{ id: string; revision: number }>;
      if (!revision) throw new Error("fact-revision-insert-missing");

      if (shotIds.length > 0) {
        const shotList = sql.join(shotIds.map((shot) => sql`${shot}::uuid`), sql`, `);
        await transaction.execute(sql`
          insert into fact_revision_shots (fact_revision_id, shot_id, analysis_id)
          select ${revision.id}, shot.id, ${command.analysisId}
          from shots as shot
          where shot.analysis_id = ${command.analysisId}
            and shot.id in (${shotList})
        `);
      }

      await transaction.execute(sql`
        update incident_candidates
        set current_fact_revision_id = ${revision.id}, review_status = 'CONFIRMED'
        where id = ${command.candidateId}
          and analysis_id = ${command.analysisId}
      `);
      // 사실 변경 전 판정은 이력으로 남기고 분석을 재평가 대기로 전환
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
    const [row] = rows as unknown as ContextRow[];
    if (!row) return { kind: "NOT_FOUND" };
    if (!row.fact_revision_id || !row.facts) return { kind: "NO_FACTS" };
    if (!row.rule_id || !row.ifab_edition) return { kind: "RULE_VERSION_UNAVAILABLE" };
    if (!row.competition || !row.season) return { kind: "RULE_VERSION_UNAVAILABLE" };
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
      const [candidate] = owned as unknown as Array<{ id: string; current_fact_revision_id: string | null; state_version: number; status: string }>;
      if (!candidate) return { kind: "NOT_FOUND" };
      // 잠금 이후에도 현재 사실과 분석 상태가 평가 시작 시점과 같은지 확인
      if (candidate.current_fact_revision_id !== command.factRevisionId) return { kind: "STALE_FACT_REVISION" };
      if (candidate.state_version !== command.analysisStateVersion || !["CANDIDATES_READY", "COMPLETED"].includes(candidate.status)) {
        return { kind: "STALE_ANALYSIS" };
      }
      const factRows = await transaction.execute(sql`
        select id
        from fact_revisions
        where id = ${command.factRevisionId}
          and incident_candidate_id = ${command.candidateId}
          and analysis_id = ${command.analysisId}
        limit 1
      `);
      if (factRows.length === 0) return { kind: "FACT_NOT_FOUND" };

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
      const [row] = inserted as unknown as Array<{ id: string }>;
      if (row) {
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
        return { kind: "CREATED", decisionId: row.id };
      }
      const existing = await transaction.execute(sql`
        select id
        from decision_results
        where incident_candidate_id = ${command.candidateId}
          and fact_revision_id = ${command.factRevisionId}
          and applied_rule_version_id = ${command.ruleVersionId}
          and rule_engine_version = ${command.ruleEngineVersion}
        limit 1
      `);
      const [saved] = existing as unknown as Array<{ id: string }>;
      return saved ? { kind: "REPLAYED", decisionId: saved.id } : { kind: "NOT_FOUND" };
    });
  }
}

export const evaluationStore = (client: DatabaseHandle): EvaluationStore => new EvaluationStore(client);
