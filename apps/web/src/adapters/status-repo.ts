import { sql } from "drizzle-orm";
import type { AnalysisResultCommand, AnalysisResultRepo, AnalysisView, CandidateView, EvidenceMedia, EvidenceMediaCommand, EvidenceMediaRepo, LatestMediaCommand, LatestMediaRepo, MediaStatusCommand, MediaStatusRepo, MediaView } from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type MediaRow = Readonly<{
  video_asset_id: string;
  video_status: string;
  validation_error_code: string | null;
  analysis_id: string | null;
  analysis_status: string | null;
  stage: string;
  progress_percent: number;
  failure_code: string | null;
  limitations: string[] | null;
  has_decisions: boolean;
  decision_count: number;
  competition: string | null;
  season: string | null;
  ifab_edition: string | null;
  verification_status: string | null;
  source_document: string | null;
}>;

type CandidateRow = Readonly<{
  id: string;
  candidate_index: number;
  start_ms: number;
  end_ms: number;
  anchor_ms: number | null;
  signal_score: number | null;
  camera_sufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  fact_revision_id: string | null;
  fact_source: "MODEL" | "USER" | "CURATOR" | null;
  fact_snapshot: unknown;
  foul_decision: string | null;
  severity: string | null;
  restart_type: string | null;
  disciplinary_action: string | null;
  decision_match: string | null;
  judgment_confidence_level: string | null;
  inconclusive_reason: string | null;
  var_reviewable: boolean | null;
  var_category: string | null;
  var_within_time_window: boolean | null;
  var_threshold_met: string | null;
  var_intervention: string | null;
  var_no_intervention_reason: string | null;
  var_not_reviewable_reason: string | null;
  var_window_closed_reason: string | null;
  var_window_exception: string | null;
  var_review_procedure: string | null;
  var_explanation: string | null;
  decision_citations: unknown[] | null;
}>;

type EvidenceRow = Readonly<{
  id: string;
  candidate_index: number;
  kind: "FRAME" | "CLIP";
}>;

export class StatusRepo implements MediaStatusRepo, AnalysisResultRepo, EvidenceMediaRepo, LatestMediaRepo {
  public constructor(private readonly client: DatabaseHandle) {}

  public async status(command: MediaStatusCommand): Promise<MediaView | null> {
    const rows = await this.client.db.execute(sql`
      select video.id as video_asset_id,
             video.status::text as video_status,
             video.validation_error_code,
             analysis.id as analysis_id,
             analysis.status as analysis_status,
             coalesce(job.stage::text, 'QUEUED') as stage,
             coalesce(job.progress_percent, 0) as progress_percent,
             analysis.failure_code,
             analysis.limitations,
             rule.competition,
             rule.season,
             rule.ifab_edition,
             rule.verification_status,
             rule.source_document,
             (select count(distinct item.incident_candidate_id)::int from decision_results as item where item.analysis_id = analysis.id) as decision_count,
             exists (
               select 1
               from decision_results as decision
               where decision.analysis_id = analysis.id
             ) as has_decisions
      from video_assets as video
      join anonymous_sessions as session on session.id = video.anonymous_session_id
      left join analyses as analysis on analysis.video_asset_id = video.id
      left join competition_rule_versions as rule on rule.id = analysis.applied_rule_version_id
      left join lateral (
        select stage, progress_percent
        from processing_jobs
        where analysis_id = analysis.id
        order by created_at desc, id desc
        limit 1
      ) as job on true
      where video.id = ${command.videoAssetId}
        and video.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and (video.expires_at is null or video.expires_at > ${command.now})
        and video.object_deleted_at is null
      limit 1
    `);
    const [row] = rows as unknown as MediaRow[];
    if (!row) return null;
    if (!row.analysis_id || !row.analysis_status) {
      return {
        videoAssetId: row.video_asset_id,
        videoStatus: row.video_status,
        validationErrorCode: row.validation_error_code,
        analysis: null,
      };
    }

    const candidates = await this.client.db.execute(sql`
      select candidate.id, candidate.candidate_index, candidate.start_ms, candidate.end_ms, candidate.anchor_ms,
             candidate.detection_confidence as signal_score, candidate.camera_sufficiency::text as camera_sufficiency,
             candidate.reasons, fact.id as fact_revision_id, fact.source::text as fact_source,
             fact.facts as fact_snapshot, decision.foul_decision::text as foul_decision,
             decision.severity::text as severity, decision.restart_type::text as restart_type,
             decision.disciplinary_action::text as disciplinary_action, decision.decision_match::text as decision_match,
             decision.judgment_confidence_level, decision.inconclusive_reason::text as inconclusive_reason,
             decision.var_reviewable, decision.var_category::text as var_category,
             decision.var_within_time_window, decision.var_threshold_met::text as var_threshold_met,
             decision.var_intervention::text as var_intervention,
             decision.var_no_intervention_reason::text as var_no_intervention_reason,
             decision.var_not_reviewable_reason::text as var_not_reviewable_reason,
             decision.var_window_closed_reason::text as var_window_closed_reason,
             decision.var_window_exception::text as var_window_exception,
             decision.var_review_procedure::text as var_review_procedure,
             decision.evaluation_snapshot #>> '{varAssessment,explanation}' as var_explanation,
             decision.citations as decision_citations
      from incident_candidates as candidate
      left join fact_revisions as fact on fact.id = candidate.current_fact_revision_id
      left join lateral (
        select result.*
        from decision_results as result
        where result.incident_candidate_id = candidate.id
          and result.analysis_id = candidate.analysis_id
        order by result.created_at desc, result.id desc
        limit 1
      ) as decision on true
      where candidate.analysis_id = ${row.analysis_id}
      order by detection_confidence desc nulls last, candidate_index
    `);
    const evidence = await this.client.db.execute(sql`
      select asset.id, candidate.candidate_index, asset.kind::text as kind
      from evidence_assets as asset
      join incident_candidates as candidate on candidate.id = asset.incident_candidate_id
      where asset.analysis_id = ${row.analysis_id}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      order by candidate.candidate_index, asset.kind, asset.id
    `);
    const grouped = new Map<number, Array<{ evidenceId: string; kind: "FRAME" | "CLIP" }>>();
    for (const item of evidence as unknown as EvidenceRow[]) {
      const entries = grouped.get(item.candidate_index) ?? [];
      entries.push({ evidenceId: item.id, kind: item.kind });
      grouped.set(item.candidate_index, entries);
    }
    const views: CandidateView[] = (candidates as unknown as CandidateRow[]).map((item) => ({
      id: item.id,
      index: item.candidate_index,
      startMs: item.start_ms,
      endMs: item.end_ms,
      anchorMs: item.anchor_ms,
      signalScore: item.signal_score,
      cameraSufficiency: item.camera_sufficiency,
      reasons: item.reasons,
      evidence: grouped.get(item.candidate_index) ?? [],
      judgment: item.fact_revision_id && item.fact_source && item.foul_decision && item.var_reviewable !== null && item.var_category && item.var_within_time_window !== null && item.var_threshold_met && item.var_intervention && item.var_window_exception && item.var_review_procedure
        ? {
            factRevisionId: item.fact_revision_id,
            facts: item.fact_snapshot as import("@replay/shared-types").EvaluationFacts,
            source: item.fact_source,
            decision: item.foul_decision as import("@replay/shared-types").EvaluationResult["decision"],
            severity: item.severity as import("@replay/shared-types").EvaluationResult["severity"],
            restart: item.restart_type as import("@replay/shared-types").EvaluationResult["restart"],
            disciplinary: item.disciplinary_action as import("@replay/shared-types").EvaluationResult["disciplinary"],
            decisionMatch: item.decision_match as import("@replay/shared-types").EvaluationResult["decisionMatch"],
            confidence: item.judgment_confidence_level as import("@replay/shared-types").EvaluationResult["confidence"],
            inconclusiveReason: item.inconclusive_reason as import("@replay/shared-types").EvaluationResult["inconclusiveReason"],
            varAssessment: {
              reviewable: item.var_reviewable,
              category: item.var_category as import("@replay/shared-types").VarAssessment["category"],
              withinTimeWindow: item.var_within_time_window,
              thresholdMet: item.var_threshold_met as import("@replay/shared-types").VarAssessment["thresholdMet"],
              reviewProcedure: item.var_review_procedure as import("@replay/shared-types").VarAssessment["reviewProcedure"],
              intervention: item.var_intervention as import("@replay/shared-types").VarAssessment["intervention"],
              noInterventionReason: item.var_no_intervention_reason as import("@replay/shared-types").VarAssessment["noInterventionReason"],
              notReviewableReason: item.var_not_reviewable_reason as import("@replay/shared-types").VarAssessment["notReviewableReason"],
              windowClosedReason: item.var_window_closed_reason as import("@replay/shared-types").VarAssessment["windowClosedReason"],
              windowException: item.var_window_exception as import("@replay/shared-types").VarAssessment["windowException"],
              explanation: item.var_explanation ?? "규정 설명 없음",
            },
            citations: (item.decision_citations ?? []) as import("@replay/shared-types").RuleCitation[],
          }
        : null,
    }));
    const allJudged = row.has_decisions && views.length > 0 && row.decision_count === views.length;
    return {
      videoAssetId: row.video_asset_id,
      videoStatus: row.video_status,
      validationErrorCode: row.validation_error_code,
      analysis: {
        analysisId: row.analysis_id,
        mode: allJudged ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
        judgmentStatus: allJudged ? "EVALUATED" : row.has_decisions ? "PARTIAL" : "NOT_EVALUATED",
        status: row.analysis_status,
        stage: row.stage,
        progressPercent: row.progress_percent,
        failureCode: row.failure_code,
        limitations: row.limitations ?? [],
        rule: row.competition && row.season && row.ifab_edition && row.verification_status
          ? {
              competition: row.competition,
              season: row.season,
              ifabEdition: row.ifab_edition,
              verificationStatus: row.verification_status,
              sourceUrl: row.source_document,
            }
          : null,
        evaluatedCount: row.decision_count,
        candidates: views,
      },
    };
  }

  public async analysis(command: AnalysisResultCommand): Promise<AnalysisView | null> {
    const rows = await this.client.db.execute(sql`
      select analysis.video_asset_id
      from analyses as analysis
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      join video_assets as video on video.id = analysis.video_asset_id
      where analysis.id = ${command.analysisId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and analysis.expires_at > ${command.now}
        and video.object_deleted_at is null
      limit 1
    `);
    const [row] = rows as unknown as Array<{ video_asset_id: string }>;
    if (!row) return null;
    const media = await this.status({
      anonymousSessionId: command.anonymousSessionId,
      videoAssetId: row.video_asset_id,
      now: command.now,
    });
    return media?.analysis ?? null;
  }

  public async media(command: EvidenceMediaCommand): Promise<EvidenceMedia | null> {
    const rows = await this.client.db.execute(sql`
      select asset.object_key, asset.kind::text as kind
      from evidence_assets as asset
      join analyses as analysis on analysis.id = asset.analysis_id
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      where asset.id = ${command.evidenceId}
        and asset.analysis_id = ${command.analysisId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and analysis.expires_at > ${command.now}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      limit 1
    `);
    const [row] = rows as unknown as Array<{ object_key: string; kind: "FRAME" | "CLIP" }>;
    if (!row) return null;
    return {
      objectKey: row.object_key,
      contentType: row.kind === "FRAME" ? "image/jpeg" : "video/mp4",
    };
  }

  public async latest(command: LatestMediaCommand): Promise<string | null> {
    const rows = await this.client.db.execute(sql`
      select video.id
      from video_assets as video
      join anonymous_sessions as session on session.id = video.anonymous_session_id
      where video.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and (video.expires_at is null or video.expires_at > ${command.now})
        and video.object_deleted_at is null
      order by video.created_at desc, video.id desc
      limit 1
    `);
    const [row] = rows as unknown as Array<{ id: string }>;
    return row?.id ?? null;
  }
}

export const statusRepo = (client: DatabaseHandle): StatusRepo => new StatusRepo(client);
