// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 진행 갱신 명령과 결과 계약 가져옴
import type { JobProgress, JobProgressCommand, JobStage } from "@replay/application";
// 저장소 연결 계약 가져옴
import type { DatabaseHandle } from "./connection";

// 현재 임대의 단계와 진행률 및 임대 기한을 줄지 않게 갱신하고 진행 이벤트 기록
export async function progress(
    client: DatabaseHandle,
    command: JobProgressCommand
): Promise<JobProgress> {
    // 진행 상태 갱신 트랜잭션
    const rows = await client.db.transaction(async (transaction) =>
        transaction.execute(sql`
      with updated as (
        update processing_jobs
        set stage = greatest(stage, ${command.stage}::job_stage),
            progress_percent = greatest(progress_percent, ${command.progressPercent}),
            heartbeat_at = greatest(heartbeat_at, ${command.now}::timestamptz),
            lease_until = greatest(lease_until, ${command.leaseUntil}::timestamptz),
            updated_at = greatest(updated_at, ${command.now}::timestamptz)
        where id = ${command.jobId}
          and status = 'PROCESSING'
          and job_revision = ${command.jobRevision}
          and lease_owner = ${command.workerId}
          and lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
          and lease_until > ${command.now}
        returning id, job_revision, attempt, stage, progress_percent, heartbeat_at, lease_until
      )
      , event as (
        insert into processing_job_events (
          job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at
        )
        select id, job_revision, attempt, 'PROGRESS', stage, progress_percent, ${command.message}, ${command.now}
        from updated
        returning job_id
      )
      select updated.stage, updated.progress_percent, updated.heartbeat_at, updated.lease_until
      from updated
      join event on event.job_id = updated.id
    `)
    );
    // 갱신 행 선택
    const [row] = rows as unknown as Array<
        Readonly<{
            // 현재 영상 처리 단계
            stage: string;
            // 작업 진행률의 백분율
            progress_percent: number;
            // 작업자가 마지막으로 생존을 알린 시각
            heartbeat_at: string;
            // 현재 작업 임대의 유효 기한
            lease_until: string;
        }>
    >;
    // 갱신 성공 결과
    if (row) {
        // 갱신된 진행률과 임대 유효 기한 반환
        return {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "UPDATED",
            // 현재 영상 처리 단계
            stage: row.stage as JobStage,
            // 작업 진행률의 백분율
            progressPercent: row.progress_percent,
            // 작업자가 마지막으로 생존을 알린 시각
            heartbeatAt: new Date(row.heartbeat_at).toISOString(),
            // 현재 작업 임대의 유효 기한
            leaseUntil: new Date(row.lease_until).toISOString()
        };
    }

    // 작업 존재 확인
    const jobs = await client.db.execute(
        sql`select id from processing_jobs where id = ${command.jobId}`
    );
    // 작업 임대 오류 결과
    return jobs.length > 0 ? { kind: "STALE_LEASE" } : { kind: "NOT_FOUND" };
}
