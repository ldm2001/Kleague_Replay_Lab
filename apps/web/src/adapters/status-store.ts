import { sql } from "drizzle-orm";
import type { AnalysisResultCommand, AnalysisResultStore as ResultPort, AnalysisView, CandidateView, EvidenceMedia, EvidenceMediaCommand, EvidenceMediaStore as EvidencePort, LatestMediaCommand, LatestMediaStore as LatestPort, MediaStatusCommand, MediaStatusStore as StatusPort, MediaView } from "@replay/application";
import type { DatabaseClient } from "@replay/database";
import { evaluateVarScope, pipelineFilter } from "@replay/rule-engine";
import { competitionRules, ruleSet } from "@replay/rule-data";
import { broadcastCueData, sceneEventData, type ScopeEvidence } from "@replay/shared-types";
import { knownVideoSource } from "./known-video-sources";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type MediaRow = Readonly<{
  video_asset_id: string;
  source_sha256: string | null;
  video_status: string;
  validation_error_code: string | null;
  analysis_id: string | null;
  analysis_status: string | null;
  pipeline_version: string | null;
  stage: string;
  progress_percent: number;
  failure_code: string | null;
  limitations: string[] | null;
  competition: string | null;
  season: string | null;
  ifab_edition: string | null;
  verification_status: string | null;
  source_document: string | null;
  match_id: string | null;
}>;

type CandidateRow = Readonly<{
  tracking: CandidateView["tracking"];
  scene_event: CandidateView["sceneEvent"];
  broadcast_cue: CandidateView["broadcastCue"];
  category: string;
  observation: CandidateView["observation"];
  linked_shots: NonNullable<CandidateView["shots"]> | null;
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
  start_ms: number;
  end_ms: number;
}>;

// 상태와 결과 조회 저장소
export class StatusStore implements StatusPort, ResultPort, EvidencePort, LatestPort {
  public constructor(private readonly client: DatabaseHandle) {}

  public async status(command: MediaStatusCommand): Promise<MediaView | null> {
    // 영상 처리 상태 조회
    const rows = await this.client.db.execute(sql`
      select video.id as video_asset_id,
             encode(video.content_sha256, 'hex') as source_sha256,
             video.status::text as video_status,
             video.validation_error_code,
             analysis.id as analysis_id,
             analysis.status as analysis_status,
             analysis.pipeline_version,
             coalesce(job.stage::text, 'QUEUED') as stage,
             coalesce(job.progress_percent, 0) as progress_percent,
             analysis.failure_code,
             analysis.limitations,
             rule.competition,
             rule.season,
             rule.ifab_edition,
             rule.verification_status,
             rule.source_document,
             analysis.match_id
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
    // 영상 상태 행 선택
    const [row] = rows as unknown as MediaRow[];
    // 영상이 없으면 빈 결과 반환
    if (!row) return null;
    // 분석이 아직 생성되지 않은 영상 반환
    if (!row.analysis_id || !row.analysis_status) {
      return {
        videoAssetId: row.video_asset_id,
        videoStatus: row.video_status,
        validationErrorCode: row.validation_error_code,
        analysis: null,
      };
    }

    // 후보와 최신 판정 조회
    const candidates = await this.client.db.execute(sql`
      select candidate.id, candidate.review_scenario::text as category, candidate.candidate_index, candidate.start_ms, candidate.end_ms, candidate.anchor_ms,
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
             decision.citations as decision_citations,
             candidate.observation,
             candidate.tracking,
             candidate.scene_event,
             candidate.broadcast_cue,
             (select jsonb_agg(jsonb_build_object('id', shot.id, 'index', shot.shot_index,
                       'startMs', shot.start_ms, 'endMs', shot.end_ms) order by shot.shot_index)
              from shots as shot where shot.analysis_id = candidate.analysis_id
                and shot.end_ms >= candidate.start_ms and shot.start_ms <= candidate.end_ms) as linked_shots
      from incident_candidates as candidate
      left join fact_revisions as fact on fact.id = candidate.current_fact_revision_id
      left join lateral (
        select result.*
        from decision_results as result
        where result.incident_candidate_id = candidate.id
          and result.analysis_id = candidate.analysis_id
          and result.fact_revision_id = candidate.current_fact_revision_id
          and result.applied_rule_version_id = (
            select applied_rule_version_id from analyses where id = candidate.analysis_id
          )
        order by result.created_at desc, result.id desc
        limit 1
      ) as decision on true
      where candidate.analysis_id = ${row.analysis_id}
      order by detection_confidence desc nulls last, candidate_index
    `);
    // 증거 파일 목록 조회
    const evidence = await this.client.db.execute(sql`
      select asset.id, candidate.candidate_index, asset.kind::text as kind, asset.start_ms, asset.end_ms
      from evidence_assets as asset
      join incident_candidates as candidate on candidate.id = asset.incident_candidate_id
      where asset.analysis_id = ${row.analysis_id}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      order by candidate.candidate_index, asset.kind, asset.id
    `);
    // 후보별 증거 묶음 초기화
    const grouped = new Map<number, Array<{ evidenceId: string; kind: "FRAME" | "CLIP" }>>();
    const scopeEvidence = new Map<number, ScopeEvidence[]>();
    // 증거 행을 후보 번호로 그룹화
    for (const item of evidence as unknown as EvidenceRow[]) {
      const entries = grouped.get(item.candidate_index) ?? [];
      entries.push({ evidenceId: item.id, kind: item.kind });
      grouped.set(item.candidate_index, entries);
      const scopeEntries = scopeEvidence.get(item.candidate_index) ?? [];
      scopeEntries.push({ evidenceId: item.id, kind: item.kind, startMs: item.start_ms, endMs: item.end_ms });
      scopeEvidence.set(item.candidate_index, scopeEntries);
    }
    // 후보 데이터 화면 모델 변환
    // 검증된 경기 연결이 없는 업로드는 추정 판본을 적용하지 않는다
    const rules = row.match_id && row.verification_status === "VERIFIED" && row.ifab_edition
      ? ruleSet(`ifab-${row.ifab_edition}`) : null;
    const pipelineOutput = row.pipeline_version != null;
    const source = knownVideoSource(row.source_sha256 ?? "");
    const book = source ? competitionRules(source.competition, source.season) : null;
    const views: CandidateView[] = (candidates as unknown as CandidateRow[]).map((item) => {
      const filter = pipelineFilter({
        startMs: item.start_ms, endMs: item.end_ms, anchorMs: item.anchor_ms,
        category: item.category ?? "OTHER",
        tracking: item.tracking ?? null,
        sceneEvent: item.scene_event ?? null,
        evidenceIds: (grouped.get(item.candidate_index) ?? []).map((entry) => entry.evidenceId),
      }, rules);
      return {
      filter,
      varScopeEvaluation: pipelineOutput && filter.status !== "EXCLUDED" ? evaluateVarScope({
        broadcastCue: item.broadcast_cue ?? null, startMs: item.start_ms, endMs: item.end_ms,
        evidence: scopeEvidence.get(item.candidate_index) ?? [], source,
      }, book) : null,
      // 보정과 재평가에 필요한 현재 사실 및 영상 근거
      factRevisionId: item.fact_revision_id ?? null,
      facts: (item.fact_snapshot ?? null) as import("@replay/shared-types").EvaluationFacts | null,
      shots: item.linked_shots ?? [],
      observation: item.observation ?? null,
      tracking: item.tracking ?? null,
      sceneEvent: item.scene_event ?? null,
      broadcastCue: item.broadcast_cue ?? null,
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
      };
    });
    // 사건 인식과 규정 검토 상태는 별개이며 근거 부족인 인식 장면도 보존한다
    const isRecognized = (candidate: CandidateView) =>
      sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs) ||
      broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs);
    const recognized = views.filter((candidate) => candidate.filter?.status !== "EXCLUDED" && isRecognized(candidate));
    const invalid = views.filter((candidate) => candidate.filter?.status === "EXCLUDED");
    const raw = views.filter((candidate) => candidate.filter?.status !== "EXCLUDED" && !isRecognized(candidate));
    const diagnosticReasons = [...new Set([...raw, ...invalid].flatMap((candidate) => candidate.filter?.reasonCodes ?? []))].sort();
    // 버전 없는 과거 분석은 기존 이력 조회를 유지하며 자동 파이프라인과 합치지 않는다
    const hasBroadcast = views.some((candidate) => broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs));
    const publicCandidates = pipelineOutput ? recognized : views.filter((candidate) => candidate.filter?.status !== "EXCLUDED");
    const judgmentViews = pipelineOutput ? recognized : views;
    // 화면에 연결한 현재 버전 판정만 완료 건수에 포함
    const evaluated = judgmentViews.filter((item) => item.judgment !== null).length;
    const allJudged = judgmentViews.length > 0 && evaluated === judgmentViews.length;
    // 상태와 결과 화면 모델 반환
    return {
      videoAssetId: row.video_asset_id,
      videoStatus: row.video_status,
      validationErrorCode: row.validation_error_code,
      analysis: {
        analysisId: row.analysis_id,
        mode: allJudged ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
        judgmentStatus: allJudged ? "EVALUATED" : evaluated > 0 ? "PARTIAL" : "NOT_EVALUATED",
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
        evaluatedCount: evaluated,
        filterSummary: {
          checkedCount: views.length,
          excludedCount: invalid.length,
          undeterminedCount: views.filter((candidate) => candidate.filter?.status === "UNDETERMINED").length,
          observedCount: views.filter((candidate) => candidate.filter?.status === "OBSERVED").length,
          applicableCount: views.filter((candidate) => candidate.filter?.status === "APPLICABLE").length,
        },
        ...(pipelineOutput ? { diagnostics: {
          rawProposalCount: raw.length,
          invalidOutputCount: invalid.length,
          recognizedEventCount: recognized.length,
          supportedEventTypes: hasBroadcast ? ["CORNER_KICK", "GOAL_GRAPHIC"] as const : ["CORNER_KICK"] as const,
          reasons: [hasBroadcast ? "BROADCAST_AND_CORNER_DETECTORS" : "CORNER_ONLY_DETECTOR", ...(raw.length > 0 ? ["UNRECOGNIZED_PROPOSALS"] : []), ...diagnosticReasons],
        } } : {}),
        candidates: publicCandidates,
      },
    };
  }

  public async analysis(command: AnalysisResultCommand): Promise<AnalysisView | null> {
    // 분석 식별자 소유권 확인
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
    // 분석 소유권 행 선택
    const [row] = rows as unknown as Array<{ video_asset_id: string }>;
    // 분석이 없으면 빈 결과 반환
    if (!row) return null;
    // 영상 상태 조회 결과에서 분석 결과 추출
    const media = await this.status({
      anonymousSessionId: command.anonymousSessionId,
      videoAssetId: row.video_asset_id,
      now: command.now,
    });
    return media?.analysis ?? null;
  }

  public async media(command: EvidenceMediaCommand): Promise<EvidenceMedia | null> {
    // 증거 파일 접근 권한 확인
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
    // 증거 접근 행 선택
    const [row] = rows as unknown as Array<{ object_key: string; kind: "FRAME" | "CLIP" }>;
    // 증거가 없으면 빈 결과 반환
    if (!row) return null;
    // 증거 종류에 맞는 콘텐츠 형식 반환
    return {
      objectKey: row.object_key,
      contentType: row.kind === "FRAME" ? "image/jpeg" : "video/mp4",
    };
  }

  public async latest(command: LatestMediaCommand): Promise<string | null> {
    // 세션 최근 영상 조회
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
    // 최근 영상 행 선택
    const [row] = rows as unknown as Array<{ id: string }>;
    // 최근 영상 식별자 반환
    return row?.id ?? null;
  }
}

export const statusStore = (client: DatabaseHandle): StatusStore => new StatusStore(client);
