// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 결과 제출 명령과 영상 검증 결과 자료 계약 가져옴
import type { JobResult, JobResultCommand, ValidationPayload } from "@replay/application";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결 계약 가져옴
import type { DatabaseHandle } from "./connection";

// 영상 검증 완료와 후속 분석 작업 생성을 현재 임대와 원본 생존 확인과 함께 한 문장으로 저장
export async function validation(
    client: DatabaseHandle,
    command: JobResultCommand,
    payload: ValidationPayload
): Promise<JobResult> {
    // 작업 임대 권한 비교용 토큰 해시 변환
    const lease = Buffer.from(command.leaseTokenHash);
    // 영상 검증 완료와 후속 분석 작업 생성을 한 묶음으로 저장
    const rows = await client.db.transaction(async (transaction) =>
        transaction.execute(sql`
          with target as materialized (
            select id, status, job_type, job_revision, attempt, lease_owner,
                   lease_token_hash, lease_until, video_asset_id,
                   ${liveJob(command.now)} as live
            from processing_jobs as job
            where id = ${command.jobId}
            for update
          ), leased as (
            select * from target
            where target.status = 'PROCESSING'
              and target.job_type = 'VALIDATE_VIDEO'
              and target.video_asset_id is not null
              and target.job_revision = ${command.jobRevision}
              and target.lease_owner = ${command.workerId}
              and target.lease_token_hash = ${lease}
              and target.lease_until > ${command.now}
          ), accepted as (
            update processing_jobs as job
            set status = 'SUCCEEDED',
                stage = 'SUCCEEDED',
                progress_percent = 100,
                heartbeat_at = ${command.now},
                lease_owner = null,
                lease_token_hash = null,
                lease_until = null,
                failure_code = null,
                retryable = null,
                updated_at = ${command.now}
            from leased
            where job.id = leased.id and leased.live
            returning job.id, job.video_asset_id, job.job_revision, job.attempt
          ), asset as (
            update video_assets as video
            set status = 'VALID',
                duration_ms = ${payload.durationMs},
                width = ${payload.width},
                height = ${payload.height},
                state_version = video.state_version + 1,
                validation_error_code = null
            from accepted
            where video.id = accepted.video_asset_id
            returning accepted.id as job_id, accepted.job_revision, accepted.attempt,
                      video.id as video_asset_id, video.anonymous_session_id,
                      video.content_sha256, video.expires_at,
                      video.competition, video.season,
                      NULL::uuid as applied_rule_version_id
          ), new_analysis as (
            insert into analyses (
              anonymous_session_id, video_asset_id, status, retention_class,
              source_fingerprint, applied_rule_version_id,
              pipeline_version, media_policy_version,
              state_version, created_at, expires_at
            )
            select anonymous_session_id, video_asset_id, 'QUEUED', 'TEMPORARY',
                   content_sha256, applied_rule_version_id,
                   'video-baseline-v1', 'media-v1', 0,
                   ${command.now}, least(expires_at, ${command.now}::timestamptz + interval '24 hours')
            from asset
            on conflict (video_asset_id) do nothing
            returning id, video_asset_id
          ), analysis as (
            select id, video_asset_id from new_analysis
            union all
            select existing.id, existing.video_asset_id
            from analyses as existing
            join asset on asset.video_asset_id = existing.video_asset_id
            where not exists(select 1 from new_analysis)
          ), analysis_job as (
            insert into processing_jobs (
              analysis_id, job_type, status, payload_version, job_revision,
              attempt, max_attempts, next_attempt_at, created_at, updated_at
            )
            select id, 'ANALYZE_VIDEO', 'QUEUED', 1, 0, 0, 3,
                   ${command.now}, ${command.now}, ${command.now}
            from analysis
            on conflict (analysis_id, job_type, payload_version) do nothing
            returning id
          ), event as (
            insert into processing_job_events (
              job_id, job_revision, attempt, event_type, stage, progress_percent, created_at
            )
            select job_id, job_revision, attempt, 'SUCCEEDED', 'SUCCEEDED', 100, ${command.now}
            from asset
            returning job_id
          )
          select case
            when exists(select 1 from event) and exists(select 1 from analysis) then 'ACCEPTED'
            when not exists(select 1 from target) then 'NOT_FOUND'
            when (select status from target) <> 'PROCESSING' then 'ALREADY_FINISHED'
            when exists(select 1 from leased where not leased.live) then 'SOURCE_UNAVAILABLE'
            else 'STALE_LEASE'
          end as kind
        `)
    );
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [row] = rows as unknown as Array<JobResult | Readonly<{ kind: "SOURCE_UNAVAILABLE" }>>;
    // 저장 결과가 없으면 부재 결과 반환
    if (!row) return { kind: "NOT_FOUND" };
    // 보존 규칙을 벗어난 원본의 검증 결과를 결과 계약의 원본 거부로 변환
    return row.kind === "SOURCE_UNAVAILABLE" ? { kind: "INVALID_RESULT", reason: "SOURCE" } : row;
}
