// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 결과 자료와 자동 평가 증거 연결 계약 가져옴
import type { AnalysisPayload, AutomaticEvidenceBinding } from "@replay/application";
// 관측 실행과 자동 평가 묶음 및 비공개 색인 자료 계약 가져옴
import type { AutomaticReviewBatch, PerceptionRun, PrivateIndex } from "@replay/shared-types";
// 비공개 관측 사건 저장 기능 가져옴
import { incidentRows } from "../incidents";
// 트랜잭션 질의 실행 계약 가져옴
import type { Executor } from "./connection";

// 비공개 요약의 저장 용량 상한 지정
export const MAX_PRIVATE_SUMMARY_BYTES = 1_048_576;

// 임대가 확인되어 분석 결과를 소유하는 작업 행 정의
export type Owner = Readonly<{
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 분석 기록의 식별자
    analysis_id: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    job_revision: number;
    // 현재 작업 실행 시도 횟수
    attempt: number;
    // 분석 대상 원본과의 일치 확인용 해시
    source_fingerprint: Buffer | null;
    // 접근과 보존을 허용하는 만료 시각
    expires_at: string | null;
}>;

// 한 트랜잭션에서 같은 작업 행과 저장 시각으로 분석 결과를 기록하는 문맥 정의
export type Write = Readonly<{
    // 결과 저장 트랜잭션의 질의 실행 기능
    transaction: Executor;
    // 분석 결과를 소유하는 작업 행
    target: Owner;
    // 작업자가 제출한 분석 결과 자료
    payload: AnalysisPayload;
    // 쓰기 직전 기한 재검사를 통과한 저장 시각
    savedAt: string;
}>;

// 원본 시간축에 연결한 화면 구간 목록 저장
export async function shots({ transaction, target, payload }: Write): Promise<void> {
    // 샷 목록 저장
    for (const item of payload.shots) {
        // 원본 시간축에 연결한 화면 구간 저장
        await transaction.execute(sql`
            insert into shots (
              analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay, camera_angle_label
            ) values (
              ${target.analysis_id}, ${item.index}, ${item.startMs}, ${item.endMs},
              ${item.playbackSpeed}::playback_speed, ${item.isReplay}, ${item.cameraAngle}
            )
          `);
    }
}

// 원시 관측과 인식 사건을 구분한 후보 장면 목록 저장
export async function candidates({ transaction, target, payload, savedAt }: Write): Promise<void> {
    // 후보 장면 목록 저장
    for (const item of payload.candidates) {
        // 원시 관측과 인식 사건을 구분하여 후보 장면 저장
        await transaction.execute(sql`
            insert into incident_candidates (
              analysis_id, candidate_index, review_scenario, start_ms, end_ms, anchor_ms,
              detection_confidence, camera_sufficiency, reasons, shot_indices, observation, tracking, scene_event, broadcast_cue, review_status, created_at
            ) values (
              ${target.analysis_id}, ${item.index}, ${item.category}::review_scenario,
              ${item.startMs}, ${item.endMs}, ${item.anchorMs}, ${item.confidence},
              ${item.cameraSufficiency}::camera_sufficiency,
              ${JSON.stringify(item.reasons)}::jsonb, ${JSON.stringify(item.shotIndices)}::jsonb,
              ${item.observation ? JSON.stringify(item.observation) : null}::jsonb,
              ${item.tracking ? JSON.stringify(item.tracking) : null}::jsonb,
              ${item.sceneEvent ? JSON.stringify(item.sceneEvent) : null}::jsonb,
              ${item.broadcastCue ? JSON.stringify(item.broadcastCue) : null}::jsonb,
              'UNREVIEWED', ${savedAt}
            )
          `);
    }
}

// 후보별 증거 자산을 저장하고 제출 순번과 저장 식별자의 대응 목록 반환하며 참조 후보가 없으면 null 반환
export async function evidence(
    { transaction, target, payload, savedAt }: Write
): Promise<AutomaticEvidenceBinding[] | null> {
    // 후보별 증거 자산 저장
    const bindings: AutomaticEvidenceBinding[] = [];
    // 제출 증거 순번을 유지하며 후보별 자산 저장 반복
    for (const [evidenceIndex, item] of (payload.evidence ?? []).entries()) {
        // 저장 증거와 연결할 현재 분석의 후보 식별자 조회
        const found = await transaction.execute(sql`
            select id
            from incident_candidates
            where analysis_id = ${target.analysis_id}
              and candidate_index = ${item.candidateIndex}
            limit 1
          `);
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [candidate] = found as unknown as Array<{ id: string }>;
        // 증거가 참조한 후보가 없으면 전체 저장 취소를 호출자에 알림
        if (!candidate) return null;
        // 후보와 원본 시간축을 연결한 증거 자산 저장
        const inserted = await transaction.execute(sql`
            insert into evidence_assets (
              analysis_id, incident_candidate_id, kind, object_key, content_sha256,
              start_ms, end_ms, width, height, created_at, expires_at
            )
            select ${target.analysis_id}, ${candidate.id}, ${item.kind}::evidence_kind,
                   ${item.objectKey}, ${Buffer.from(item.contentSha256, "hex")},
                   ${item.startMs}, ${item.endMs}, ${item.width}, ${item.height},
                   ${savedAt}, expires_at
            from analyses
            where id = ${target.analysis_id}
            returning id
          `);
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [saved] = inserted as unknown as Array<{
            // 다른 기록과 구별하는 고유 식별자
            id: string;
        }>;
        // 증거 자산 저장 식별자를 얻은 경우에만 연결 기록 추가
        if (saved)
            // 제출 순번과 저장된 증거 식별자의 대응 관계 보존
            bindings.push({
                ...item,
                // 제출 목록에서 증거를 찾는 순번
                evidenceIndex,
                // 저장된 증거 자산의 식별자
                evidenceId: saved.id
            });
    }
    // 제출 순번과 저장 식별자의 대응 목록 반환
    return bindings;
}

// 후보별 자동 평가와 검증된 증거 연결을 내부 이력에 저장
export async function automaticReview(
    { transaction, target, payload, savedAt }: Write,
    automatic: AutomaticReviewBatch,
    bindings: readonly AutomaticEvidenceBinding[]
): Promise<void> {
    // 저장된 증거 개수와 연결 요약 용량의 계약 위반 확인
    if (
        bindings.length !== (payload.evidence ?? []).length ||
        Buffer.byteLength(JSON.stringify(bindings), "utf8") >
            MAX_PRIVATE_SUMMARY_BYTES
    ) {
        // 일부 증거 누락이나 연결 요약 용량 초과를 오류로 전달
        throw new Error("Automatic evidence bindings exceed storage contract");
    }
    // 후보별 자동 평가와 검증된 증거 연결을 내부 이력에 저장
    await transaction.execute(sql`
            insert into analysis_automatic_reviews (analysis_id, job_id, job_revision, source_sha256,
              evaluator_version, pipeline_version, summary, evidence_bindings, created_at, expires_at)
            values (${target.analysis_id}, ${target.id}, ${target.job_revision}, ${target.source_fingerprint},
              ${automatic.version}, ${payload.pipelineVersion}, ${JSON.stringify(automatic)}::jsonb,
              ${JSON.stringify(bindings)}::jsonb, ${savedAt}, ${target.expires_at})
          `);
}

// 관측 실행의 모델 출처와 원본 해시 및 비공개 요약 저장
export async function perceptionRun(
    { transaction, target, payload, savedAt }: Write,
    perception: PerceptionRun,
    summary: string
): Promise<void> {
    // 관측 실행의 모델 출처와 원본 해시 및 비공개 요약 저장
    await transaction.execute(sql`
            insert into analysis_perception_runs (
              analysis_id, job_id, job_revision, schema_version, pipeline_version,
              source_sha256, artifact_object_key, artifact_sha256, artifact_size_bytes,
              model_provenance, summary, created_at, expires_at
            ) values (
              ${target.analysis_id}, ${target.id}, ${target.job_revision}, ${perception.schemaVersion},
              ${payload.pipelineVersion}, ${Buffer.from(perception.sourceSha256, "hex")},
              ${perception.artifact.objectKey}, ${Buffer.from(perception.artifact.contentSha256, "hex")},
              ${perception.artifact.sizeBytes}, ${JSON.stringify(perception.models)}::jsonb,
              ${summary}::jsonb, ${savedAt}, ${target.expires_at}
            )
          `);
}

// 서버 검증을 거친 관측 실행이 있을 때만 일반 관측과 유형별 사건을 같은 트랜잭션에 비공개 저장
export async function privateIndex(
    { transaction, target, payload, savedAt }: Write,
    index: PrivateIndex,
    perception: PerceptionRun | undefined
): Promise<void> {
    // 서버 검증 관측이나 보존 기한 또는 원본 해시가 없는 비공개 색인 저장 차단
    if (!perception || !target.expires_at || !target.source_fingerprint) {
        throw new Error("INCIDENT_VERIFICATION_REQUIRED");
    }
    // 용량과 시한 초과로 생략한 색인은 요약 표시만 남기고 행을 쓰지 않음
    if (index.status === "INDEXED") {
        await incidentRows(transaction, index.batch, {
            analysisId: target.analysis_id, jobId: target.id, jobRevision: target.job_revision,
            sourceSha256: Buffer.from(target.source_fingerprint).toString("hex"),
            artifactSha256: perception.artifact.contentSha256,
            now: savedAt, expiresAt: new Date(target.expires_at).toISOString(),
            evidence: payload.evidence ?? []
        });
    }
}

// 분석 완료와 작업 성공 및 완료 이벤트를 같은 저장 시각으로 기록
export async function completion({ transaction, target, payload, savedAt }: Write): Promise<void> {
    // 영상 처리 완료와 규정 판단 가능 여부의 독립 처리
    await transaction.execute(sql`
          update analyses
          set status = 'COMPLETED',
              pipeline_version = ${payload.pipelineVersion},
              limitations = ${JSON.stringify(payload.limitations)}::jsonb,
              state_version = state_version + 1,
              completed_at = ${savedAt}
          where id = ${target.analysis_id}
        `);
    // 분석 작업 완료 처리
    await transaction.execute(sql`
          update processing_jobs
          set status = 'SUCCEEDED', stage = 'SUCCEEDED', progress_percent = 100,
              heartbeat_at = ${savedAt}, lease_owner = null, lease_token_hash = null,
              lease_until = null, failure_code = null, retryable = null, updated_at = ${savedAt}
          where id = ${target.id}
        `);
    // 작업 완료 이벤트 기록
    await transaction.execute(sql`
          insert into processing_job_events (
            job_id, job_revision, attempt, event_type, stage, progress_percent, created_at
          ) values (
            ${target.id}, ${target.job_revision}, ${target.attempt},
            'SUCCEEDED', 'SUCCEEDED', 100, ${savedAt}
          )
        `);
}
