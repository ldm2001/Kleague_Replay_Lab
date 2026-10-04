// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 결과 제출 명령과 작업자 실패 결과 자료 계약 가져옴
import type { JobFailurePayload, JobResult, JobResultCommand } from "@replay/application";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결 계약 가져옴
import type { DatabaseHandle } from "./connection";

// 남은 시도와 원본 보존을 확인해 작업자 실패를 재대기 또는 최종 실패 중 하나로 한 문장에 저장
export async function failure(
    client: DatabaseHandle,
    command: JobResultCommand,
    payload: JobFailurePayload
): Promise<JobResult> {
    // 작업 임대 권한 비교용 토큰 해시 변환
    const lease = Buffer.from(command.leaseTokenHash);
    // 재시도 요청이 없으면 시도가 남아도 최종 실패로 닫는 재선점 시각
    const retryAt = command.retryAt ?? null;
    // 남은 시도와 원본 보존을 확인해 재대기 또는 최종 실패 중 하나만 한 문장에 저장
    const rows = await client.db.transaction(async (transaction) =>
        transaction.execute(sql`
          with target as materialized (
            select id, status, job_revision, attempt, max_attempts, lease_owner,
                   lease_token_hash, lease_until, video_asset_id, analysis_id,
                   ${liveJob(command.now)} as live
            from processing_jobs as job
            where id = ${command.jobId}
            for update
          ), leased as (
            select target.*,
                   (
                     ${retryAt}::timestamptz is not null
                     and target.attempt < target.max_attempts
                     and target.live
                   ) as requeue
            from target
            where target.status = 'PROCESSING'
              and target.job_revision = ${command.jobRevision}
              and target.lease_owner = ${command.workerId}
              and target.lease_token_hash = ${lease}
              and target.lease_until > ${command.now}
          ), requeued as (
            update processing_jobs as job
            set status = 'QUEUED',
                stage = 'QUEUED',
                progress_percent = 0,
                heartbeat_at = ${command.now},
                lease_owner = null,
                lease_token_hash = null,
                lease_until = null,
                next_attempt_at = ${retryAt},
                updated_at = ${command.now}
            from leased
            where job.id = leased.id and leased.requeue
            returning job.id, job.job_revision, job.attempt
          ), failed as (
            update processing_jobs as job
            set status = 'FAILED',
                stage = 'FAILED',
                progress_percent = 100,
                heartbeat_at = ${command.now},
                lease_owner = null,
                lease_token_hash = null,
                lease_until = null,
                failure_code = ${payload.failureCode},
                retryable = ${payload.retryable},
                updated_at = ${command.now}
            from leased
            where job.id = leased.id and not leased.requeue
            returning job.id, job.video_asset_id, job.analysis_id, job.job_revision, job.attempt
          ), asset as (
            update video_assets as video
            set status = 'REJECTED',
                state_version = video.state_version + 1,
                validation_error_code = ${payload.failureCode}
            from failed
            where video.id = failed.video_asset_id
            returning video.id
          ), analysis as (
            update analyses as item
            set status = 'FAILED',
                failure_code = ${payload.failureCode},
                state_version = item.state_version + 1
            from failed
            where item.id = failed.analysis_id
            returning item.id
          ), failed_event as (
            insert into processing_job_events (
              job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at
            )
            select id, job_revision, attempt, 'FAILED', 'FAILED', 100,
                   ${payload.failureCode}, ${command.now}
            from failed
            returning job_id
          ), requeued_event as (
            insert into processing_job_events (
              job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at
            )
            select id, job_revision, attempt, 'REQUEUED', 'QUEUED', 0,
                   ${payload.failureCode}, ${command.now}
            from requeued
            returning job_id
          )
          select case
            when exists(select 1 from failed_event) or exists(select 1 from requeued_event)
              then 'ACCEPTED'
            when not exists(select 1 from target) then 'NOT_FOUND'
            when (select status from target) <> 'PROCESSING' then 'ALREADY_FINISHED'
            else 'STALE_LEASE'
          end as kind
        `)
    );
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [row] = rows as unknown as Array<JobResult>;
    // 저장 결과 반환
    return row ?? { kind: "NOT_FOUND" };
}
