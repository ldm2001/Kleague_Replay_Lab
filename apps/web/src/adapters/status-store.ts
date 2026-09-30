// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql, type SQL } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    AnalysisResultCommand,
    AnalysisResultStore as ResultPort,
    AutomaticEvidenceBinding,
    AutomaticSnapshot,
    CandidateSnapshot,
    EvidenceMedia,
    EvidenceMediaCommand,
    EvidenceMediaStore as EvidencePort,
    EvidenceSnapshot,
    LatestMediaCommand,
    LatestMediaStore as LatestPort,
    MediaSnapshot,
    MediaStatusCommand,
    MediaStatusStore as StatusPort
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";
// 자동 평가 묶음과 인식 실행의 공유 자료 계약 가져옴
import type { AutomaticReviewBatch, PerceptionRun } from "@replay/shared-types";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import {
    activeSession,
    CONSISTENT_READ,
    liveAnalysis,
    liveEvidence,
    liveVideo
} from "./visibility";

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
    tracking: CandidateSnapshot["tracking"];
    // 장면에서 인식한 사건과 근거
    scene_event: CandidateSnapshot["sceneEvent"];
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcast_cue: CandidateSnapshot["broadcastCue"];
    // 후보 사건의 분류
    category: string;
    // 판정 사실과 구분하여 보존하는 원시 관측
    observation: CandidateSnapshot["observation"];
    // 후보에 연결된 화면 구간 목록
    linked_shots: CandidateSnapshot["shots"];
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

// 보존된 자동 평가와 당시 모델 출처 및 현재 경기 문맥 조회 행 정의
type AutomaticRow = Readonly<{
    // 보존된 후보별 자동 평가 묶음
    summary: AutomaticReviewBatch;
    // 제출 증거 순서와 저장 식별자의 연결
    evidence_bindings: AutomaticEvidenceBinding[];
    // 현재 경기와 규정 연결의 유효 여부
    match_context_valid: boolean;
    // 사용한 모델과 고정 가중치의 출처
    model_provenance: PerceptionRun["models"] | null;
}>;

// 한 읽기 스냅숏 안에서 질의를 실행하는 기능 정의
type Reader = (statement: SQL) => Promise<unknown>;

// 후보 조회 행의 이름만 바꾼 후보 원자료 생성
const candidateSnapshot = (row: CandidateRow): CandidateSnapshot => ({
    // 다른 기록과 구별하는 고유 식별자
    id: row.id,
    // 처리 결과에서 후보 장면을 찾는 순번
    index: row.candidate_index,
    // 후보 사건의 분류
    category: row.category,
    // 원본 영상 기준 구간 시작 밀리초
    startMs: row.start_ms,
    // 원본 영상 기준 구간 종료 밀리초
    endMs: row.end_ms,
    // 장면을 대표하는 원본 영상 시각
    anchorMs: row.anchor_ms,
    // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
    signalScore: row.signal_score,
    // 관측에 필요한 화면의 충분성
    cameraSufficiency: row.camera_sufficiency,
    // 후보 생성 또는 처리 결과의 근거 사유
    reasons: row.reasons,
    // 판정 사실과 구분하여 보존하는 원시 관측
    observation: row.observation,
    // 동일 물체의 연속 이동 관측
    tracking: row.tracking,
    // 장면에서 인식한 사건과 근거
    sceneEvent: row.scene_event,
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcastCue: row.broadcast_cue,
    // 후보에 연결된 화면 구간 목록
    shots: row.linked_shots,
    // 평가에 사용한 사실 판본 식별자
    factRevisionId: row.fact_revision_id,
    // 사실 기록의 출처
    factSource: row.fact_source,
    // 평가에 연결한 당시 사실 내용
    facts: row.fact_snapshot,
    // 규정 평가로 얻은 반칙 판단
    foulDecision: row.foul_decision,
    // 규정 평가에서 구분한 행위의 심각도
    severity: row.severity,
    // 규정 평가에 따른 경기 재개 방식
    restartType: row.restart_type,
    // 규정 평가에 따른 징계 조치
    disciplinaryAction: row.disciplinary_action,
    // 관측 원심과 규정 평가의 일치 여부
    decisionMatch: row.decision_match,
    // 규정 판단 근거의 충분성 수준
    confidenceLevel: row.judgment_confidence_level,
    // 결론을 확정하지 못한 사유
    inconclusiveReason: row.inconclusive_reason,
    // 영상 판독 검토 대상 여부
    varReviewable: row.var_reviewable,
    // 영상 판독의 적용 범주
    varCategory: row.var_category,
    // 영상 판독 허용 시점 충족 여부
    varWithinTimeWindow: row.var_within_time_window,
    // 영상 판독 개입 문턱 충족 여부
    varThresholdMet: row.var_threshold_met,
    // 영상 판독 개입 판단
    varIntervention: row.var_intervention,
    // 영상 판독에 개입하지 않는 이유
    varNoInterventionReason: row.var_no_intervention_reason,
    // 영상 판독 검토 대상이 아닌 이유
    varNotReviewableReason: row.var_not_reviewable_reason,
    // 영상 판독 허용 시점이 지난 이유
    varWindowClosedReason: row.var_window_closed_reason,
    // 영상 판독 시점 제한에 적용한 예외
    varWindowException: row.var_window_exception,
    // 영상 판독 검토 절차
    varReviewProcedure: row.var_review_procedure,
    // 영상 판독 판단의 설명
    varExplanation: row.var_explanation,
    // 보존된 규정 판단의 인용 목록
    citations: row.decision_citations
});

// 증거 조회 행의 이름만 바꾼 증거 원자료 생성
const evidenceSnapshot = (row: EvidenceRow): EvidenceSnapshot => ({
    // 저장된 증거 자산의 식별자
    evidenceId: row.id,
    // 처리 결과에서 후보 장면을 찾는 순번
    candidateIndex: row.candidate_index,
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: row.kind,
    // 원본 영상 기준 구간 시작 밀리초
    startMs: row.start_ms,
    // 원본 영상 기준 구간 종료 밀리초
    endMs: row.end_ms,
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: row.object_key,
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: row.content_sha256
});

// 자동 평가 조회 행의 이름만 바꾼 자동 평가 원자료 생성
const automaticSnapshot = (row: AutomaticRow): AutomaticSnapshot => ({
    // 보존된 후보별 자동 평가 묶음
    summary: row.summary,
    // 제출 증거 순서와 저장 식별자의 연결
    evidenceBindings: row.evidence_bindings,
    // 현재 경기와 규정 연결의 유효 여부
    matchContextValid: row.match_context_valid,
    // 사용한 모델과 고정 가중치의 출처
    modelProvenance: row.model_provenance
});

// 상태와 결과 조회 저장소
export class StatusStore implements StatusPort, ResultPort, EvidencePort, LatestPort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 소유와 만료를 확인한 영상 원자료를 하나의 읽기 스냅숏으로 조회
    public async status(command: MediaStatusCommand): Promise<MediaSnapshot | null> {
        // 여러 질의가 같은 시점의 자료를 보도록 하나의 읽기 전용 트랜잭션에서 조회
        return this.client.db.transaction(
            (transaction) => this.snapshot((statement) => transaction.execute(statement), command),
            CONSISTENT_READ
        );
    }

    // 주어진 읽기 스냅숏에서 소유와 만료를 확인한 영상과 분석 원자료 조회
    private async snapshot(
        read: Reader,
        command: MediaStatusCommand
    ): Promise<MediaSnapshot | null> {
        // 영상 처리 상태 조회
        const rows = await read(sql`
      select video.id as video_asset_id,
             encode(video.content_sha256, 'hex') as source_sha256,
             video.status::text as video_status,
             video.validation_error_code,
             analysis.id as analysis_id,
             -- 대기 기록은 유지하고 임대 중인 작업의 현재 단계를 조회 시점 상태로 파생
             case
               when analysis.status = 'QUEUED'
                 and job.job_type = 'ANALYZE_VIDEO'
                 and job.status = 'PROCESSING' then job.stage::text
               else analysis.status
             end as analysis_status,
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
        and ${liveAnalysis(command.now)}
      left join competition_rule_versions as rule on rule.id = analysis.applied_rule_version_id
      left join lateral (
        select job_type, status, stage, progress_percent
        from processing_jobs
        where analysis_id = analysis.id
        order by created_at desc, id desc
        limit 1
      ) as job on true
      where video.id = ${command.videoAssetId}
        and video.anonymous_session_id = ${command.anonymousSessionId}
        and ${activeSession(command.now)}
        and ${liveVideo(command.now)}
      limit 1
    `);
        // 영상 상태 행 선택
        const [row] = rows as unknown as MediaRow[];
        // 영상이 없으면 빈 결과 반환
        if (!row) return null;
        // 분석 연결과 무관한 원본 영상 원자료 구성
        const media = {
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId: row.video_asset_id,
            // 분석한 원본 영상의 내용 해시
            sourceSha256: row.source_sha256,
            // 영상 파일의 검증 상태
            videoStatus: row.video_status,
            // 영상 유효성 검사 실패 사유
            validationErrorCode: row.validation_error_code
        };
        // 분석이 아직 생성되지 않은 영상은 분석 원자료 없이 반환
        if (!row.analysis_id || !row.analysis_status) return { ...media, analysis: null };

        // 후보와 최신 판정 조회
        const candidates = await read(sql`
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
        const evidence = await read(sql`
      select asset.id, candidate.candidate_index, asset.kind::text as kind, asset.start_ms, asset.end_ms,
             asset.object_key, encode(asset.content_sha256, 'hex') as content_sha256
      from evidence_assets as asset
      join incident_candidates as candidate on candidate.id = asset.incident_candidate_id
      where asset.analysis_id = ${row.analysis_id}
        and ${liveEvidence(command.now)}
      order by candidate.candidate_index, asset.kind, asset.id
    `);
        // 처리 버전이 같아야 하는 자동 평가 조건상 예전 수동 이력은 조회 생략
        const pipelineOutput = row.pipeline_version != null;
        // 보존된 자동 평가와 현재 경기 문맥 및 모델 출처 조회
        const automaticRows = pipelineOutput
            ? await read(sql`
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
        and review.expires_at > ${command.now} and ${liveAnalysis(command.now)}
      order by review.created_at desc, review.id desc limit 1
    `)
            : [];
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [automatic] = automaticRows as unknown as AutomaticRow[];
        // 같은 스냅숏에서 읽은 분석 진행과 규정 및 후보 증거 자동 평가 원자료 반환
        return {
            ...media,
            // 원본 영상에 연결된 분석 원자료
            analysis: {
                // 분석 기록의 식별자
                analysisId: row.analysis_id,
                // 임대 중인 작업 단계를 반영한 분석 처리 상태
                status: row.analysis_status,
                // 영상 처리 절차를 구별하는 버전
                pipelineVersion: row.pipeline_version,
                // 현재 영상 처리 단계
                stage: row.stage,
                // 작업 진행률의 백분율
                progressPercent: row.progress_percent,
                // 처리 실패 원인을 구별하는 코드
                failureCode: row.failure_code,
                // 처리가 제공하지 못하는 관측의 한계
                limitations: row.limitations,
                // 검증된 경기 기록의 식별자
                matchId: row.match_id,
                // 대회 규정 판본 식별자
                ruleVersionId: row.rule_version_id,
                // 규정 적용 대상 대회
                competition: row.competition,
                // 규정 적용 대상 시즌
                season: row.season,
                // 국제 축구 규정의 판본
                ifabEdition: row.ifab_edition,
                // 규정 문맥의 검증 상태
                verificationStatus: row.verification_status,
                // 규정 검증에 사용한 원문 출처
                sourceDocument: row.source_document,
                // 신호 점수 순서로 정렬한 후보 원자료
                candidates: (candidates as unknown as CandidateRow[]).map(candidateSnapshot),
                // 후보 순번과 종류 순서로 정렬한 유효 증거 원자료
                evidence: (evidence as unknown as EvidenceRow[]).map(evidenceSnapshot),
                // 가장 최근의 유효한 자동 평가 원자료
                automatic: automatic ? automaticSnapshot(automatic) : null
            }
        };
    }

    // 세션 소유 분석이 속한 영상 원자료를 하나의 읽기 스냅숏으로 조회
    public async analysis(command: AnalysisResultCommand): Promise<MediaSnapshot | null> {
        // 소유권 확인과 원자료 조회가 같은 시점의 자료를 보도록 하나의 읽기 전용 트랜잭션 사용
        return this.client.db.transaction(async (transaction) => {
            // 트랜잭션 연결에서 질의를 실행하는 기능 생성
            const read: Reader = (statement) => transaction.execute(statement);
            // 분석 식별자 소유권 확인
            const rows = await read(sql`
      select analysis.video_asset_id
      from analyses as analysis
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      join video_assets as video on video.id = analysis.video_asset_id
      where analysis.id = ${command.analysisId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and ${activeSession(command.now)}
        and ${liveAnalysis(command.now)}
        and ${liveVideo(command.now)}
      limit 1
    `);
            // 분석 소유권 행 선택
            const [row] = rows as unknown as Array<{ video_asset_id: string }>;
            // 분석이 없으면 빈 결과 반환
            if (!row) return null;
            // 소유가 확인된 분석이 속한 영상 원자료를 같은 스냅숏에서 조회
            return this.snapshot(read, {
                // 업로드 소유자를 구별하는 익명 세션 식별자
                anonymousSessionId: command.anonymousSessionId,
                // 업로드된 원본 영상 기록의 식별자
                videoAssetId: row.video_asset_id,
                // 유효 기한 판단에 사용하는 현재 시각
                now: command.now
            });
        }, CONSISTENT_READ);
    }

    // 저장된 미디어의 접근 정보 조회
    public async media(command: EvidenceMediaCommand): Promise<EvidenceMedia | null> {
        // 분석 조회와 같은 소유와 보존 조건으로 증거 파일 접근 권한 확인
        const rows = await this.client.db.execute(sql`
      select asset.object_key, asset.kind::text as kind
      from evidence_assets as asset
      join analyses as analysis on analysis.id = asset.analysis_id
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      join video_assets as video on video.id = analysis.video_asset_id
      where asset.id = ${command.evidenceId}
        and asset.analysis_id = ${command.analysisId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and ${activeSession(command.now)}
        and ${liveAnalysis(command.now)}
        and ${liveVideo(command.now)}
        and ${liveEvidence(command.now)}
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
        and ${activeSession(command.now)}
        and ${liveVideo(command.now)}
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
