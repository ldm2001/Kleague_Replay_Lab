// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    AnalysisResultCommand,
    AnalysisResultStore as ResultPort,
    AnalysisView,
    CandidateView,
    EvidenceMedia,
    EvidenceMediaCommand,
    EvidenceMediaStore as EvidencePort,
    LatestMediaCommand,
    LatestMediaStore as LatestPort,
    MediaStatusCommand,
    MediaStatusStore as StatusPort,
    MediaView
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";
// 규정 자료와 평가 기능 가져옴
import { scopeVerdict, pipelineFilter, perceptionModelPins } from "@replay/rule-engine";
// 규정 자료와 평가 기능 가져옴
import { competitionRules, ruleSet } from "@replay/rule-data";
// 공유 자료 계약과 검증 기능 가져옴
import { broadcastCueData, sceneEventData, type ScopeEvidence } from "@replay/shared-types";
// 원본 해시에 대응하는 검증된 경기 문맥 가져옴
import { knownVideoSource } from "./sources";
// 자동 평가의 경기 문맥과 증거 연결 기능 가져옴
import { automaticJudgments, type AutomaticEvidenceBinding } from "./binding";
// 공유 자료 계약과 검증 기능 가져옴
import type { AutomaticReviewBatch, AutomaticRuleContext } from "../shared/review";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;

// 원본 영상과 분석 및 규정 상태 조회 행 정의
type MediaRow = Readonly<{
    // 업로드된 원본 영상 기록의 식별자
    video_asset_id: string;
    // 분석한 원본 영상의 내용 해시
    source_sha256: string | null;
    // 영상 파일의 검증 상태
    video_status: string;
    // 영상 유효성 검사 실패 사유
    validation_error_code: string | null;
    // 분석 기록의 식별자
    analysis_id: string | null;
    // 영상 분석 처리 상태
    analysis_status: string | null;
    // 영상 처리 절차를 구별하는 버전
    pipeline_version: string | null;
    // 현재 영상 처리 단계
    stage: string;
    // 작업 진행률의 백분율
    progress_percent: number;
    // 처리 실패 원인을 구별하는 코드
    failure_code: string | null;
    // 처리가 제공하지 못하는 관측의 한계
    limitations: string[] | null;
    // 규정 적용 대상 대회
    competition: string | null;
    // 규정 적용 대상 시즌
    season: string | null;
    // 국제 축구 규정의 판본
    ifab_edition: string | null;
    // 규정 문맥의 검증 상태
    verification_status: string | null;
    // 규정 검증에 사용한 원문 출처
    source_document: string | null;
    // 검증된 경기 기록의 식별자
    match_id: string | null;
    // 대회 규정 판본 식별자
    rule_version_id: string | null;
}>;

// 후보 장면과 보존된 사실 및 판단 조회 행 정의
type CandidateRow = Readonly<{
    // 동일 물체의 연속 이동 관측
    tracking: CandidateView["tracking"];
    // 장면에서 인식한 사건과 근거
    scene_event: CandidateView["sceneEvent"];
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcast_cue: CandidateView["broadcastCue"];
    // 후보 사건의 분류
    category: string;
    // 판정 사실과 구분하여 보존하는 원시 관측
    observation: CandidateView["observation"];
    // 후보에 연결된 화면 구간 목록
    linked_shots: NonNullable<CandidateView["shots"]> | null;
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 처리 결과에서 후보 장면을 찾는 순번
    candidate_index: number;
    // 원본 영상 기준 구간 시작 밀리초
    start_ms: number;
    // 원본 영상 기준 구간 종료 밀리초
    end_ms: number;
    // 장면을 대표하는 원본 영상 시각
    anchor_ms: number | null;
    // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
    signal_score: number | null;
    // 관측에 필요한 화면의 충분성
    camera_sufficiency: "LOW" | "MEDIUM" | "HIGH";
    // 후보 생성 또는 처리 결과의 근거 사유
    reasons: string[];
    // 평가에 사용한 사실 판본 식별자
    fact_revision_id: string | null;
    // 사실 기록의 출처
    fact_source: "MODEL" | "USER" | "CURATOR" | null;
    // 평가에 연결한 당시 사실 내용
    fact_snapshot: unknown;
    // 규정 평가로 얻은 반칙 판단
    foul_decision: string | null;
    // 규정 평가에서 구분한 행위의 심각도
    severity: string | null;
    // 규정 평가에 따른 경기 재개 방식
    restart_type: string | null;
    // 규정 평가에 따른 징계 조치
    disciplinary_action: string | null;
    // 관측 원심과 규정 평가의 일치 여부
    decision_match: string | null;
    // 규정 판단 근거의 충분성 수준
    judgment_confidence_level: string | null;
    // 결론을 확정하지 못한 사유
    inconclusive_reason: string | null;
    // 영상 판독 검토 대상 여부
    var_reviewable: boolean | null;
    // 영상 판독의 적용 범주
    var_category: string | null;
    // 영상 판독 허용 시점 충족 여부
    var_within_time_window: boolean | null;
    // 영상 판독 개입 문턱 충족 여부
    var_threshold_met: string | null;
    // 영상 판독 개입 판단
    var_intervention: string | null;
    // 영상 판독에 개입하지 않는 이유
    var_no_intervention_reason: string | null;
    // 영상 판독 검토 대상이 아닌 이유
    var_not_reviewable_reason: string | null;
    // 영상 판독 허용 시점이 지난 이유
    var_window_closed_reason: string | null;
    // 영상 판독 시점 제한에 적용한 예외
    var_window_exception: string | null;
    // 영상 판독 검토 절차
    var_review_procedure: string | null;
    // 영상 판독 판단의 설명
    var_explanation: string | null;
    // 보존된 규정 판단의 인용 목록
    decision_citations: unknown[] | null;
}>;

// 후보와 연결한 증거 자산 조회 행 정의
type EvidenceRow = Readonly<{
    // 객체 저장소에서 파일을 찾는 경로
    object_key: string;
    // 파일 내용의 동일성을 대조하는 해시
    content_sha256: string;
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 처리 결과에서 후보 장면을 찾는 순번
    candidate_index: number;
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "FRAME" | "CLIP";
    // 원본 영상 기준 구간 시작 밀리초
    start_ms: number;
    // 원본 영상 기준 구간 종료 밀리초
    end_ms: number;
}>;

// 상태와 결과 조회 저장소
export class StatusStore implements StatusPort, ResultPort, EvidencePort, LatestPort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 상태 처리
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
             analysis.match_id, rule.id as rule_version_id
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
            // 분석 연결이 없는 영상의 현재 상태만 반환
            return {
                // 업로드된 원본 영상 기록의 식별자
                videoAssetId: row.video_asset_id,
                // 영상 파일의 검증 상태
                videoStatus: row.video_status,
                // 영상 유효성 검사 실패 사유
                validationErrorCode: row.validation_error_code,
                // 아직 연결되지 않은 분석 상태
                analysis: null
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
      select asset.id, candidate.candidate_index, asset.kind::text as kind, asset.start_ms, asset.end_ms,
             asset.object_key, encode(asset.content_sha256, 'hex') as content_sha256
      from evidence_assets as asset
      join incident_candidates as candidate on candidate.id = asset.incident_candidate_id
      where asset.analysis_id = ${row.analysis_id}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      order by candidate.candidate_index, asset.kind, asset.id
    `);
        // 후보별 증거 묶음 초기화
        const grouped = new Map<number, Array<{ evidenceId: string; kind: "FRAME" | "CLIP" }>>();
        // 후보별 범주 평가에 사용할 증거 조회표 생성
        const scopeEvidence = new Map<number, ScopeEvidence[]>();
        // 증거 행을 후보 번호로 그룹화
        for (const item of evidence as unknown as EvidenceRow[]) {
            // 현재 후보에 누적된 증거 목록 읽음
            const entries = grouped.get(item.candidate_index) ?? [];
            // 현재 후보의 공개 증거 식별자와 종류 추가
            entries.push({ evidenceId: item.id, kind: item.kind });
            // 후보 순번으로 증거 목록을 찾을 수 있도록 조회표 갱신
            grouped.set(item.candidate_index, entries);
            // 현재 후보의 범주 평가용 증거 목록 읽음
            const scopeEntries = scopeEvidence.get(item.candidate_index) ?? [];
            // 범주 평가용 증거에 원본 시간 범위 추가
            scopeEntries.push({
                // 저장된 증거 자산의 식별자
                evidenceId: item.id,
                // 처리 분기 또는 자료 종류를 구별하는 값
                kind: item.kind,
                // 원본 영상 기준 구간 시작 밀리초
                startMs: item.start_ms,
                // 원본 영상 기준 구간 종료 밀리초
                endMs: item.end_ms
            });
            // 후보 순번으로 시간 범위 증거를 찾도록 조회표 갱신
            scopeEvidence.set(item.candidate_index, scopeEntries);
        }
        // 후보 데이터 화면 모델 변환
        // 검증된 경기 연결이 없는 업로드는 추정 판본을 적용하지 않음
        const rules =
            row.match_id && row.verification_status === "VERIFIED" && row.ifab_edition
                ? ruleSet(`ifab-${row.ifab_edition}`)
                : null;
        // 처리 버전 유무로 자동 산출물과 예전 수동 이력 구분
        const pipelineOutput = row.pipeline_version != null;
        // 원본 내용 해시와 일치하는 검증된 경기 등록 정보 조회
        const source = knownVideoSource(row.source_sha256 ?? "");
        // 등록된 원본의 대회와 시즌에 맞는 규정집 조회
        const book = source ? competitionRules(source.competition, source.season) : null;
        // 보존된 자동 평가와 현재 경기 문맥 및 모델 출처 조회
        const automaticRows = pipelineOutput
            ? await this.client.db.execute(sql`
      select review.summary, review.evidence_bindings, perception.model_provenance,
             exists(select 1 from matches as match join competition_rule_versions as rule
               on rule.id = analysis.applied_rule_version_id and rule.competition = match.competition and rule.season = match.season
               and match.match_date >= rule.effective_from and (rule.effective_to is null or match.match_date <= rule.effective_to)
               and rule.verification_status = 'VERIFIED' and nullif(trim(rule.source_document), '') is not null
               where match.id = analysis.match_id) as match_context_valid
      from analysis_automatic_reviews as review
      join analyses as analysis on analysis.id = review.analysis_id
      join processing_jobs as job on job.id = review.job_id and job.analysis_id = analysis.id
      join video_assets as video on video.id = analysis.video_asset_id
      left join analysis_perception_runs as perception on perception.job_id = review.job_id
        and perception.analysis_id = review.analysis_id and perception.job_revision = review.job_revision
        and perception.source_sha256 = review.source_sha256 and perception.pipeline_version = review.pipeline_version
        and perception.expires_at > ${command.now}
      where review.analysis_id = ${row.analysis_id}
        and review.source_sha256 = analysis.source_fingerprint and review.source_sha256 = video.content_sha256
        and review.pipeline_version = analysis.pipeline_version
        and review.evaluator_version = 'automatic-review-v1'
        and job.status = 'SUCCEEDED' and job.job_type = 'ANALYZE_VIDEO' and job.job_revision = review.job_revision
        and review.expires_at > ${command.now} and analysis.expires_at > ${command.now}
      order by review.created_at desc, review.id desc limit 1
    `)
            : [];
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [automatic] = automaticRows as unknown as Array<{
            // 세부 자료에서 보존할 처리 요약
            summary: AutomaticReviewBatch;
            // 제출 증거 순서와 저장 식별자의 연결
            evidence_bindings: AutomaticEvidenceBinding[];
            // 현재 경기와 규정 연결의 유효 여부
            match_context_valid: boolean;
            // 사용한 모델과 고정 가중치의 출처
            model_provenance: import("@replay/shared-types").PerceptionRun["models"] | null;
        }>;
        // 검증된 경기와 판본이 모두 있을 때만 규정 문맥 생성
        const currentRule: AutomaticRuleContext | null =
            row.rule_version_id &&
            row.match_id &&
            row.competition &&
            row.season &&
            row.ifab_edition &&
            row.verification_status === "VERIFIED"
                ? {
                      // 다른 기록과 구별하는 고유 식별자
                      id: row.rule_version_id,
                      // 검증된 경기 기록의 식별자
                      matchId: row.match_id,
                      // 규정 적용 대상 대회
                      competition: row.competition,
                      // 규정 적용 대상 시즌
                      season: row.season,
                      // 국제 축구 규정 판본 식별자
                      ifabVersionId: `ifab-${row.ifab_edition}`,
                      // 규정 문맥의 검증 상태
                      verificationStatus: "VERIFIED"
                  }
                : null;
        // 보존된 모델 출처가 현재 승인된 고정 가중치와 일치하는지 확인
        const currentPins =
            automatic?.model_provenance &&
            Object.values(perceptionModelPins).every((pin) =>
                automatic.model_provenance!.some(
                    (model) =>
                        model.component === pin.component &&
                        model.modelId === pin.modelId &&
                        model.revision === pin.revision &&
                        model.weightsSha256 === pin.weightsSha256
                )
            );
        // 현재 규정 문맥과 고정 모델 출처를 통과한 자동 평가만 조회
        const automaticViews =
            automatic && currentPins && automatic.match_context_valid
                ? automaticJudgments(
                      automatic.summary,
                      automatic.evidence_bindings,
                      (evidence as unknown as EvidenceRow[]).map((item, evidenceIndex) => ({
                          // 제출 목록에서 증거를 찾는 순번
                          evidenceIndex,
                          // 저장된 증거 자산의 식별자
                          evidenceId: item.id,
                          // 처리 결과에서 후보 장면을 찾는 순번
                          candidateIndex: item.candidate_index,
                          // 처리 분기 또는 자료 종류를 구별하는 값
                          kind: item.kind,
                          // 객체 저장소에서 파일을 찾는 경로
                          objectKey: item.object_key,
                          // 파일 내용의 동일성을 대조하는 해시
                          contentSha256: item.content_sha256,
                          // 원본 영상 기준 구간 시작 밀리초
                          startMs: item.start_ms,
                          // 원본 영상 기준 구간 종료 밀리초
                          endMs: item.end_ms,
                          // 영상 또는 증거 이미지의 가로 크기
                          width: null,
                          // 영상 또는 증거 이미지의 세로 크기
                          height: null
                      })),
                      currentRule
                  )
                : new Map();
        // 후보의 관측과 사실 및 규정 필터 결과를 조회 형태로 구성
        const views: CandidateView[] = (candidates as unknown as CandidateRow[]).map((item) => {
            // 후보의 시간과 사건 및 증거 연결을 규정 필터에 대조
            const filter = pipelineFilter(
                {
                    // 원본 영상 기준 구간 시작 밀리초
                    startMs: item.start_ms,
                    // 원본 영상 기준 구간 종료 밀리초
                    endMs: item.end_ms,
                    // 장면을 대표하는 원본 영상 시각
                    anchorMs: item.anchor_ms,
                    // 후보 사건의 분류
                    category: item.category ?? "OTHER",
                    // 동일 물체의 연속 이동 관측
                    tracking: item.tracking ?? null,
                    // 장면에서 인식한 사건과 근거
                    sceneEvent: item.scene_event ?? null,
                    // 참조하는 저장 증거 식별자 목록
                    evidenceIds: (grouped.get(item.candidate_index) ?? []).map(
                        (entry) => entry.evidenceId
                    )
                },
                rules
            );
            // 후보 관측과 보존된 판단 및 별도 범주 평가를 구분한 조회 자료 반환
            return {
                // 완료 조건을 별도로 검사하는 자동 규정 평가 결과
                automaticJudgment: automaticViews.get(item.candidate_index) ?? null,
                // 원시 후보에 대한 규정 필터 결과
                filter,
                // 전체 반칙 판단과 별개인 영상 판독 범주 평가
                varScopeEvaluation:
                    pipelineOutput && filter.status !== "EXCLUDED"
                        ? scopeVerdict(
                              {
                                  // 규정 사실과 구분하여 보존하는 방송 단서
                                  broadcastCue: item.broadcast_cue ?? null,
                                  // 원본 영상 기준 구간 시작 밀리초
                                  startMs: item.start_ms,
                                  // 원본 영상 기준 구간 종료 밀리초
                                  endMs: item.end_ms,
                                  // 원본에 연결한 증거 자료 또는 접근 기능
                                  evidence: scopeEvidence.get(item.candidate_index) ?? [],
                                  // 값의 출처 또는 원본 접근 수단
                                  source
                              },
                              book
                          )
                        : null,
                // 보정과 재평가에 필요한 현재 사실 및 영상 근거
                factRevisionId: item.fact_revision_id ?? null,
                // 확인된 출처와 판본을 보존하는 규정 사실 자료
                facts: (item.fact_snapshot ?? null) as
                    import("@replay/shared-types").EvaluationFacts | null,
                // 원본 영상의 화면 구간 목록
                shots: item.linked_shots ?? [],
                // 판정 사실과 구분하여 보존하는 원시 관측
                observation: item.observation ?? null,
                // 동일 물체의 연속 이동 관측
                tracking: item.tracking ?? null,
                // 장면에서 인식한 사건과 근거
                sceneEvent: item.scene_event ?? null,
                // 규정 사실과 구분하여 보존하는 방송 단서
                broadcastCue: item.broadcast_cue ?? null,
                // 다른 기록과 구별하는 고유 식별자
                id: item.id,
                // 목록 안에서 해당 항목을 식별하는 순번
                index: item.candidate_index,
                // 원본 영상 기준 구간 시작 밀리초
                startMs: item.start_ms,
                // 원본 영상 기준 구간 종료 밀리초
                endMs: item.end_ms,
                // 장면을 대표하는 원본 영상 시각
                anchorMs: item.anchor_ms,
                // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
                signalScore: item.signal_score,
                // 관측에 필요한 화면의 충분성
                cameraSufficiency: item.camera_sufficiency,
                // 후보 생성 또는 처리 결과의 근거 사유
                reasons: item.reasons,
                // 원본에 연결한 증거 자료 또는 접근 기능
                evidence: grouped.get(item.candidate_index) ?? [],
                // 사실과 규정을 대조한 판단 결과
                judgment:
                    item.fact_revision_id &&
                    item.fact_source &&
                    item.foul_decision &&
                    item.var_reviewable !== null &&
                    item.var_category &&
                    item.var_within_time_window !== null &&
                    item.var_threshold_met &&
                    item.var_intervention &&
                    item.var_window_exception &&
                    item.var_review_procedure
                        ? {
                              // 평가에 사용한 사실 판본 식별자
                              factRevisionId: item.fact_revision_id,
                              // 확인된 출처와 판본을 보존하는 규정 사실 자료
                              facts: item.fact_snapshot as import("@replay/shared-types").EvaluationFacts,
                              // 값의 출처 또는 원본 접근 수단
                              source: item.fact_source,
                              // 사실과 규정을 대조하는 판단 처리
                              decision:
                                  item.foul_decision as import("@replay/shared-types").EvaluationResult["decision"],
                              // 규정 평가에서 구분한 행위의 심각도
                              severity:
                                  item.severity as import("@replay/shared-types").EvaluationResult["severity"],
                              // 판단에 따른 경기 재개 방식
                              restart:
                                  item.restart_type as import("@replay/shared-types").EvaluationResult["restart"],
                              // 판단에 따른 징계 조치
                              disciplinary:
                                  item.disciplinary_action as import("@replay/shared-types").EvaluationResult["disciplinary"],
                              // 관측 원심과 규정 평가의 일치 여부
                              decisionMatch:
                                  item.decision_match as import("@replay/shared-types").EvaluationResult["decisionMatch"],
                              // 관측 또는 판단 근거의 신뢰 수준
                              confidence:
                                  item.judgment_confidence_level as import("@replay/shared-types").EvaluationResult["confidence"],
                              // 결론을 확정하지 못한 사유
                              inconclusiveReason:
                                  item.inconclusive_reason as import("@replay/shared-types").EvaluationResult["inconclusiveReason"],
                              // 영상 판독 개입에 대한 규정 평가
                              varAssessment: {
                                  // 영상 판독의 검토 가능 여부
                                  reviewable: item.var_reviewable,
                                  // 후보 사건의 분류
                                  category:
                                      item.var_category as import("@replay/shared-types").VarAssessment["category"],
                                  // 영상 판독 허용 시점 충족 여부
                                  withinTimeWindow: item.var_within_time_window,
                                  // 영상 판독 개입 문턱 충족 여부
                                  thresholdMet:
                                      item.var_threshold_met as import("@replay/shared-types").VarAssessment["thresholdMet"],
                                  // 영상 판독 검토 절차
                                  reviewProcedure:
                                      item.var_review_procedure as import("@replay/shared-types").VarAssessment["reviewProcedure"],
                                  // 영상 판독 개입 판단
                                  intervention:
                                      item.var_intervention as import("@replay/shared-types").VarAssessment["intervention"],
                                  // 영상 판독에 개입하지 않는 이유
                                  noInterventionReason:
                                      item.var_no_intervention_reason as import("@replay/shared-types").VarAssessment["noInterventionReason"],
                                  // 영상 판독 검토 대상이 아닌 이유
                                  notReviewableReason:
                                      item.var_not_reviewable_reason as import("@replay/shared-types").VarAssessment["notReviewableReason"],
                                  // 영상 판독 허용 시점 종료 사유
                                  windowClosedReason:
                                      item.var_window_closed_reason as import("@replay/shared-types").VarAssessment["windowClosedReason"],
                                  // 영상 판독 시점 제한의 예외
                                  windowException:
                                      item.var_window_exception as import("@replay/shared-types").VarAssessment["windowException"],
                                  // 판단 결과의 사용자 안내 설명
                                  explanation: item.var_explanation ?? "규정 설명 없음"
                              },
                              // 판단 근거가 된 규정 인용 목록
                              citations: (item.decision_citations ??
                                  []) as import("@replay/shared-types").RuleCitation[]
                          }
                        : null
            };
        });

        // 사건 인식과 규정 검토 상태는 별개이며 근거 부족인 인식 장면도 보존
        const recognition = (candidate: CandidateView) =>
            sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs) ||
            broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs);
        // 제외되지 않았으며 사건 종류를 인식한 후보 분리
        const recognized = views.filter(
            (candidate) => candidate.filter?.status !== "EXCLUDED" && recognition(candidate)
        );
        // 규정 필터에서 유효하지 않다고 제외한 후보 분리
        const invalid = views.filter((candidate) => candidate.filter?.status === "EXCLUDED");
        // 사건 종류를 인식하지 못한 원시 변화 후보 분리
        const raw = views.filter(
            (candidate) => candidate.filter?.status !== "EXCLUDED" && !recognition(candidate)
        );
        // 원시 후보와 잘못된 출력의 사유를 중복 없이 정렬
        const diagnosticReasons = [
            ...new Set(
                [...raw, ...invalid].flatMap((candidate) => candidate.filter?.reasonCodes ?? [])
            )
        ].sort();
        // 버전 없는 과거 분석은 기존 이력 조회를 유지하며 자동 파이프라인과 합치지 않음
        const hasBroadcast = views.some((candidate) =>
            broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs)
        );
        // 자동 출력과 예전 이력에 맞춰 조회 후보를 분리
        const publicCandidates = pipelineOutput
            ? views.filter(
                  (candidate) =>
                      recognized.includes(candidate) || candidate.automaticJudgment != null
              )
            : views.filter((candidate) => candidate.filter?.status !== "EXCLUDED");
        // 자동 산출물에서는 인식 사건만 판단 집계 대상으로 선택
        const judgmentViews = pipelineOutput ? recognized : views;
        // 화면에 연결한 현재 버전 판정만 완료 건수에 포함
        const evaluated = judgmentViews.filter((item) => item.judgment !== null).length;
        // 평가 대상이 존재하고 모두 판단되었는지 확인
        const allJudged = judgmentViews.length > 0 && evaluated === judgmentViews.length;
        // 상태와 결과 화면 모델 반환
        return {
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId: row.video_asset_id,
            // 영상 파일의 검증 상태
            videoStatus: row.video_status,
            // 영상 유효성 검사 실패 사유
            validationErrorCode: row.validation_error_code,
            // 원본 영상과 연결된 분석 상태 및 결과 자료
            analysis: {
                ...(automatic
                    ? {
                          // 후보별 자동 평가 진행의 내부 집계
                          automaticReviewSummary: {
                              // 인식 처리가 실제 다룬 영상 범위
                              videoCoverage: automatic.summary.videoCoverage,
                              // 요약 일부가 잘려 보존되지 않았는지 여부
                              summaryTruncated: automatic.summary.summaryTruncated,
                              // 자동 평가 조건을 검사한 후보 수
                              checkedCount: automatic.summary.rows.length,
                              // 지원 질문의 평가를 완료한 후보 수
                              completedCount: automaticViews.size,
                              // 근거 부족 등으로 평가가 막힌 후보 수
                              blockedCount: automatic.summary.blockedCount
                          }
                      }
                    : {}),
                // 분석 기록의 식별자
                analysisId: row.analysis_id,
                // 자료를 해석하거나 표시하는 방식
                mode: allJudged ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
                // 영상 처리 성공과 구분한 규정 판단 상태
                judgmentStatus: allJudged
                    ? "EVALUATED"
                    : evaluated > 0
                      ? "PARTIAL"
                      : "NOT_EVALUATED",
                // 처리 상태 또는 요청 응답 상태
                status: row.analysis_status,
                // 현재 영상 처리 단계
                stage: row.stage,
                // 작업 진행률의 백분율
                progressPercent: row.progress_percent,
                // 처리 실패 원인을 구별하는 코드
                failureCode: row.failure_code,
                // 처리가 제공하지 못하는 관측의 한계
                limitations: row.limitations ?? [],
                // 경기 문맥에 맞춰 연결한 규정 자료
                rule:
                    row.competition && row.season && row.ifab_edition && row.verification_status
                        ? {
                              // 규정 적용 대상 대회
                              competition: row.competition,
                              // 규정 적용 대상 시즌
                              season: row.season,
                              // 국제 축구 규정의 판본
                              ifabEdition: row.ifab_edition,
                              // 규정 문맥의 검증 상태
                              verificationStatus: row.verification_status,
                              // 원본 영상의 출처 주소
                              sourceUrl: row.source_document
                          }
                        : null,
                // 완료된 반칙 규정 평가 수
                evaluatedCount: evaluated,
                // 전체 내부 후보의 필터 처리 집계
                filterSummary: {
                    // 자동 평가 조건을 검사한 후보 수
                    checkedCount: views.length,
                    // 필터가 제외한 후보 수
                    excludedCount: invalid.length,
                    // 필터가 판단을 확정하지 못한 후보 수
                    undeterminedCount: views.filter(
                        (candidate) => candidate.filter?.status === "UNDETERMINED"
                    ).length,
                    // 관측된 사건 후보 수
                    observedCount: views.filter(
                        (candidate) => candidate.filter?.status === "OBSERVED"
                    ).length,
                    // 규정 적용 가능 조건을 충족한 후보 수
                    applicableCount: views.filter(
                        (candidate) => candidate.filter?.status === "APPLICABLE"
                    ).length
                },
                ...(pipelineOutput
                    ? {
                          // 최종 결과와 분리한 내부 진단 자료
                          diagnostics: {
                              // 사건으로 인식되지 않은 원시 변화 후보 수
                              rawProposalCount: raw.length,
                              // 유효성 조건을 통과하지 못한 산출물 수
                              invalidOutputCount: invalid.length,
                              // 사건 종류를 인식한 후보 수
                              recognizedEventCount: recognized.length,
                              // 현재 인식기가 지원하는 사건 유형 목록
                              supportedEventTypes: hasBroadcast
                                  ? (["CORNER_KICK", "GOAL_GRAPHIC"] as const)
                                  : (["CORNER_KICK"] as const),
                              // 후보 생성 또는 처리 결과의 근거 사유
                              reasons: [
                                  hasBroadcast
                                      ? "BROADCAST_AND_CORNER_DETECTORS"
                                      : "CORNER_ONLY_DETECTOR",
                                  ...(raw.length > 0 ? ["UNRECOGNIZED_PROPOSALS"] : []),
                                  ...diagnosticReasons
                              ]
                          }
                      }
                    : {}),
                // 파울 확정과 별개로 관리하는 후보 장면 목록
                candidates: publicCandidates
            }
        };
    }

    // 영상 분석 처리
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
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId: command.anonymousSessionId,
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId: row.video_asset_id,
            // 유효 기한 판단에 사용하는 현재 시각
            now: command.now
        });
        // 해당 영상의 분석 자료를 반환하고 없으면 빈 값 반환
        return media?.analysis ?? null;
    }

    // 저장된 미디어의 접근 정보 조회
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
            // 객체 저장소에서 파일을 찾는 경로
            objectKey: row.object_key,
            // 파일의 실제 또는 허용 콘텐츠 형식
            contentType: row.kind === "FRAME" ? "image/jpeg" : "video/mp4"
        };
    }

    // 최근 분석 조회
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

// 저장소 접근 구성
export const statusStore = (client: DatabaseHandle): StatusStore => new StatusStore(client);
