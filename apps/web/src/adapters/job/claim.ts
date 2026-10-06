// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql, type SQL } from "drizzle-orm";
// 작업 선점 명령과 임대 계약 가져옴
import type { JobClaimCommand, JobLease, JobType } from "@replay/application";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결 계약 가져옴
import type { DatabaseHandle } from "./connection";

// 작업 선점과 임대 상태 조회 행 정의
type JobRow = Readonly<{
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 영상 검증과 분석의 작업 구분
    job_type: string;
    // 작업 입력 자료 구조의 버전
    payload_version: number;
    // 재실행 이전 요청을 구분하는 작업 판본
    job_revision: number;
    // 현재 작업 실행 시도 횟수
    attempt: number;
    // 현재 작업 임대의 유효 기한
    lease_until: string;
    // 현재 영상 처리 단계
    stage: string;
    // 작업 진행률의 백분율
    progress_percent: number;
    // 분석 기록의 식별자
    analysis_id: string | null;
    // 업로드된 원본 영상 기록의 식별자
    video_asset_id: string | null;
    // 객체 저장소에서 파일을 찾는 경로
    object_key: string | null;
    // 잠근 행의 직전 작업 판본
    previous_revision: number;
    // 잠근 행의 직전 시도 횟수
    previous_attempt: number;
    // 넘겨받은 만료 임대의 기한이며 대기 작업 선점이면 빈 값
    expired_at: string | null;
}>;

// 임대 만료로 끝난 시도의 실패 부호
const timeout = "WORKER_TIMEOUT";

// 선택한 작업을 재시도 없는 실패로 닫고 검증 영상과 분석 상태 및 실패 이벤트를 같은 사유로 한 문장에 기록
const termination = (
    selection: SQL,
    code: "WORKER_TIMEOUT" | "SOURCE_UNAVAILABLE",
    now: string
) => sql`
    with expired as (${selection}), failed as (
      update processing_jobs as job
      set status = 'FAILED', stage = 'FAILED', failure_code = ${code},
          retryable = false, lease_owner = null, lease_token_hash = null,
          lease_until = null, updated_at = ${now}
      from expired where job.id = expired.id
      returning job.id, job.analysis_id, job.video_asset_id, job.job_type,
                job.job_revision, job.attempt, job.progress_percent
    ), videos as (
      update video_assets as video
      set status = 'REJECTED', validation_error_code = ${code},
          state_version = video.state_version + 1
      from failed
      where video.id = failed.video_asset_id and failed.job_type = 'VALIDATE_VIDEO'
        and video.status = 'VALIDATING'
      returning video.id
    ), analyses as (
      update analyses as analysis
      set status = 'FAILED', failure_code = ${code},
          state_version = analysis.state_version + 1
      from failed
      where analysis.id = failed.analysis_id and failed.job_type = 'ANALYZE_VIDEO'
        and analysis.status not in ('COMPLETED', 'FAILED')
      returning analysis.id
    )
    insert into processing_job_events (job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at)
    select id, job_revision, attempt, 'FAILED', 'FAILED', progress_percent, ${code}, ${now} from failed
`;

// 회복할 수 없는 작업을 먼저 닫은 뒤 보존 규칙 안의 처리할 작업 선점과 해시로 받은 임대 저장
export async function claim(
    client: DatabaseHandle,
    command: JobClaimCommand
): Promise<JobLease | null> {
    // 작업 선점 트랜잭션
    const rows = await client.db.transaction(async (transaction) => {
        // 마지막 시도에서 만료된 작업을 작은 배치로 종료
        await transaction.execute(termination(sql`
        select id from processing_jobs
        where job_type = ${command.jobType} and status = 'PROCESSING'
          and lease_until <= ${command.now} and attempt >= max_attempts
        order by lease_until, id
        for update skip locked limit 100
      `, timeout, command.now));
        // 대상 원본이나 소유 세션이 보존 규칙을 벗어나 다시 살아날 수 없는 선점 가능 작업을 작은 배치로 종료
        await transaction.execute(termination(sql`
        select job.id from processing_jobs as job
        where job.job_type = ${command.jobType}
          and (
            job.status = 'QUEUED'
            or (
              job.status = 'PROCESSING' and job.lease_until <= ${command.now}
              and job.attempt < job.max_attempts
            )
          )
          and not ${liveJob(command.now)}
        order by job.created_at, job.id
        for update skip locked limit 100
      `, "SOURCE_UNAVAILABLE", command.now));
        // 보존 규칙 안의 선점 대상을 잠가 다음 시도로 갱신하고 잠근 행의 직전 시도 값 반환
        const selected = await transaction.execute(sql`
        with picked as (
          select id, status, job_revision, attempt, lease_until
          from processing_jobs as job
          where job_type = ${command.jobType}
            and (
              (status = 'QUEUED' and (next_attempt_at is null or next_attempt_at <= ${command.now}))
              or
              (status = 'PROCESSING' and lease_until <= ${command.now})
            )
            and attempt < max_attempts
            and ${liveJob(command.now)}
          order by next_attempt_at nulls first, created_at, id
          for update skip locked
          limit 1
        )
        update processing_jobs as job
        set status = 'PROCESSING',
            job_revision = job.job_revision + 1,
            attempt = job.attempt + 1,
            lease_owner = ${command.workerId},
            lease_token_hash = ${Buffer.from(command.leaseTokenHash)},
            lease_until = ${command.leaseUntil},
            stage = case
              when job.job_type = 'VALIDATE_VIDEO' then 'VALIDATING'::job_stage
              else 'SEGMENTING'::job_stage
            end,
            progress_percent = 0,
            heartbeat_at = ${command.now},
            updated_at = ${command.now}
        from picked
        where job.id = picked.id
        returning
          job.id,
          job.job_type,
          job.payload_version,
          job.job_revision,
          job.attempt,
          job.lease_until,
          job.stage,
          job.progress_percent,
          job.analysis_id,
          job.video_asset_id,
          (
            select object_key
            from video_assets
            where id = coalesce(
              job.video_asset_id,
              (select video_asset_id from analyses where id = job.analysis_id)
            )
          ) as object_key,
          picked.job_revision as previous_revision,
          picked.attempt as previous_attempt,
          case when picked.status = 'PROCESSING' then picked.lease_until end as expired_at
      `);
        // 선점 행 선택
        const [selectedRow] = selected as unknown as JobRow[];
        // 대기 작업 없음
        if (!selectedRow) return selected;
        // 만료 임대를 넘겨받았으면 직전 시도 종료를 만료 시각의 재대기 이벤트로 선점 이벤트보다 먼저 기록
        if (selectedRow.expired_at !== null) {
            await transaction.execute(sql`
            insert into processing_job_events (
              job_id, job_revision, attempt, event_type,
              stage, progress_percent, message, created_at
            ) values (
              ${selectedRow.id}, ${selectedRow.previous_revision}, ${selectedRow.previous_attempt},
              'REQUEUED', 'QUEUED', 0, ${timeout}, ${selectedRow.expired_at}
            )
          `);
        }
        // 선점 이벤트 기록
        await transaction.execute(sql`
        insert into processing_job_events (
          job_id, job_revision, attempt, event_type, stage, progress_percent, created_at
        ) values (
          ${selectedRow.id}, ${selectedRow.job_revision}, ${selectedRow.attempt}, 'CLAIMED',
          ${selectedRow.stage}::job_stage, ${selectedRow.progress_percent}, ${command.now}
        )
      `);
        // 선점 행 반환
        return selected;
    });
    // 선점 행 선택
    const [row] = rows as unknown as JobRow[];
    // 대기 작업 없음
    if (!row) return null;

    // 선점 결과 반환
    return {
        // 처리 작업의 식별자
        jobId: row.id,
        // 영상 검증과 분석의 작업 구분
        jobType: row.job_type as JobType,
        // 작업 입력 자료 구조의 버전
        payloadVersion: row.payload_version,
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: row.job_revision,
        // 현재 작업 실행 시도 횟수
        attempt: row.attempt,
        // 현재 영상 처리 단계
        stage: row.stage as JobLease["stage"],
        // 작업 진행률의 백분율
        progressPercent: row.progress_percent,
        // 현재 작업 임대의 유효 기한
        leaseUntil: new Date(row.lease_until).toISOString(),
        // 분석 기록의 식별자
        analysisId: row.analysis_id,
        // 업로드된 원본 영상 기록의 식별자
        videoAssetId: row.video_asset_id,
        // 객체 저장소에서 파일을 찾는 경로
        objectKey: row.object_key
    };
}
