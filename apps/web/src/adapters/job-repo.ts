import { createHash as digest, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  JobClaim,
  JobClaimCommand,
  JobProgress,
  JobProgressCommand,
  JobProgressRepository,
  JobRepository,
  JobResult,
  JobResultCommand,
  JobResultRepository,
  JobStage,
  JobType,
  EvidenceAccess,
  EvidenceAccessCommand,
  EvidenceAccessRepo,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type JobRow = Readonly<{
  id: string;
  job_type: string;
  payload_version: number;
  job_revision: number;
  attempt: number;
  lease_until: string;
  stage: string;
  progress_percent: number;
  analysis_id: string | null;
  video_asset_id: string | null;
  object_key: string | null;
}>;

// 작업 저장소 어댑터
export class JobRepo implements JobRepository, JobProgressRepository, JobResultRepository, EvidenceAccessRepo {
  public constructor(private readonly client: DatabaseHandle) {}

  public async claim(command: JobClaimCommand): Promise<JobClaim | null> {
    // Lease 토큰 생성
    const leaseToken = randomBytes(32).toString("base64url");
    // Lease 토큰 해시
    const leaseTokenHash = digest("sha256").update(leaseToken, "utf8").digest();

    // 작업 선점 트랜잭션
    const rows = await this.client.db.transaction(async (transaction) => {
      // 선점 대상 선택과 잠금
      const selected = await transaction.execute(sql`
        with picked as (
          select id
          from processing_jobs
          where job_type = ${command.jobType}
            and (
              (status = 'QUEUED' and (next_attempt_at is null or next_attempt_at <= ${command.now}))
              or
              (status = 'PROCESSING' and lease_until <= ${command.now})
            )
            and attempt < max_attempts
          order by next_attempt_at nulls first, created_at, id
          for update skip locked
          limit 1
        )
        update processing_jobs as job
        set status = 'PROCESSING',
            job_revision = job.job_revision + 1,
            attempt = job.attempt + 1,
            lease_owner = ${command.workerId},
            lease_token_hash = ${leaseTokenHash},
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
          ) as object_key
      `);
      // 선점 행 선택
      const [selectedRow] = selected as unknown as JobRow[];
      // 대기 작업 없음
      if (!selectedRow) return selected;
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
      jobId: row.id,
      jobType: row.job_type as JobType,
      payloadVersion: row.payload_version,
      jobRevision: row.job_revision,
      attempt: row.attempt,
      stage: row.stage as JobClaim["stage"],
      progressPercent: row.progress_percent,
      leaseToken,
      leaseUntil: new Date(row.lease_until).toISOString(),
      analysisId: row.analysis_id,
      videoAssetId: row.video_asset_id,
      objectKey: row.object_key,
    };
  }

  public async progress(command: JobProgressCommand): Promise<JobProgress> {
    // 진행 상태 갱신 트랜잭션
    const rows = await this.client.db.transaction(async (transaction) => transaction.execute(sql`
      with updated as (
        update processing_jobs
        set stage = ${command.stage}::job_stage,
            progress_percent = ${command.progressPercent},
            heartbeat_at = ${command.now},
            lease_until = ${command.leaseUntil},
            updated_at = ${command.now}
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
    `));
    // 갱신 행 선택
    const [row] = rows as unknown as Array<Readonly<{
      stage: string;
      progress_percent: number;
      heartbeat_at: string;
      lease_until: string;
    }>>;
    // 갱신 성공 결과
    if (row) {
      return {
        kind: "UPDATED",
        stage: row.stage as JobStage,
        progressPercent: row.progress_percent,
        heartbeatAt: new Date(row.heartbeat_at).toISOString(),
        leaseUntil: new Date(row.lease_until).toISOString(),
      };
    }

    // 작업 존재 확인
    const jobs = await this.client.db.execute(sql`select id from processing_jobs where id = ${command.jobId}`);
    // Lease 오류 결과
    return jobs.length > 0 ? { kind: "STALE_LEASE" } : { kind: "NOT_FOUND" };
  }

  public async result(command: JobResultCommand): Promise<JobResult> {
    const lease = Buffer.from(command.leaseTokenHash);
    let rows: unknown[];
    if (command.payload.kind === "VALIDATED") {
      const payload = command.payload;
      rows = await this.client.db.transaction(async (transaction) => transaction.execute(sql`
          with target as materialized (
            select id, status, job_type, job_revision, attempt, lease_owner,
                   lease_token_hash, lease_until, video_asset_id
            from processing_jobs
            where id = ${command.jobId}
            for update
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
            from target
            where job.id = target.id
              and target.status = 'PROCESSING'
              and target.job_type = 'VALIDATE_VIDEO'
              and target.video_asset_id is not null
              and target.job_revision = ${command.jobRevision}
              and target.lease_owner = ${command.workerId}
              and target.lease_token_hash = ${lease}
              and target.lease_until > ${command.now}
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
                      (
                        select version.id
                        from competition_rule_versions as version
                        where version.competition = video.competition
                          and version.season = video.season
                          and ${command.now}::date between version.effective_from
                            and coalesce(version.effective_to, 'infinity'::date)
                        order by version.effective_from desc
                        limit 1
                      ) as applied_rule_version_id
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
            else 'STALE_LEASE'
          end as kind
        `));
    } else if (command.payload.kind === "ANALYZED") {
      const payload = command.payload;
      rows = await this.client.db.transaction(async (transaction) => {
        const selected = await transaction.execute(sql`
          select id, status, job_type, job_revision, attempt, lease_owner,
                 lease_token_hash, lease_until, analysis_id
          from processing_jobs
          where id = ${command.jobId}
          for update
        `);
        const [target] = selected as unknown as Array<{
          id: string;
          status: string;
          job_type: string;
          job_revision: number;
          attempt: number;
          lease_owner: string | null;
          lease_token_hash: Buffer | null;
          lease_until: string | null;
          analysis_id: string | null;
        }>;
        if (!target) return [{ kind: "NOT_FOUND" }];
        if (target.status !== "PROCESSING") return [{ kind: "ALREADY_FINISHED" }];
        const validLease =
          target.job_type === "ANALYZE_VIDEO" &&
          target.analysis_id !== null &&
          target.job_revision === command.jobRevision &&
          target.lease_owner === command.workerId &&
          target.lease_token_hash !== null &&
          Buffer.compare(target.lease_token_hash, lease) === 0 &&
          target.lease_until !== null &&
          new Date(target.lease_until).getTime() > new Date(command.now).getTime();
        if (!validLease) return [{ kind: "STALE_LEASE" }];

        for (const item of payload.shots) {
          await transaction.execute(sql`
            insert into shots (
              analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay, camera_angle_label
            ) values (
              ${target.analysis_id}, ${item.index}, ${item.startMs}, ${item.endMs},
              ${item.playbackSpeed}::playback_speed, ${item.isReplay}, ${item.cameraAngle}
            )
          `);
        }

        for (const item of payload.candidates) {
          await transaction.execute(sql`
            insert into incident_candidates (
              analysis_id, candidate_index, review_scenario, start_ms, end_ms, anchor_ms,
              detection_confidence, camera_sufficiency, reasons, shot_indices, review_status, created_at
            ) values (
              ${target.analysis_id}, ${item.index}, ${item.category}::review_scenario,
              ${item.startMs}, ${item.endMs}, ${item.anchorMs}, ${item.confidence},
              ${item.cameraSufficiency}::camera_sufficiency,
              ${JSON.stringify(item.reasons)}::jsonb, ${JSON.stringify(item.shotIndices)}::jsonb,
              'UNREVIEWED', ${command.now}
            )
          `);
        }

        for (const item of payload.evidence ?? []) {
          const prefix = `evidence/${target.analysis_id}/${target.id}/`;
          if (!item.objectKey.startsWith(prefix)) {
            throw new Error("Evidence object key is outside the claimed job scope");
          }
          const candidates = await transaction.execute(sql`
            select id
            from incident_candidates
            where analysis_id = ${target.analysis_id}
              and candidate_index = ${item.candidateIndex}
            limit 1
          `);
          const [candidate] = candidates as unknown as Array<{ id: string }>;
          if (!candidate) throw new Error("Evidence candidate is unavailable");
          await transaction.execute(sql`
            insert into evidence_assets (
              analysis_id, incident_candidate_id, kind, object_key, content_sha256,
              start_ms, end_ms, width, height, created_at, expires_at
            )
            select ${target.analysis_id}, ${candidate.id}, ${item.kind}::evidence_kind,
                   ${item.objectKey}, ${Buffer.from(item.contentSha256, "hex")},
                   ${item.startMs}, ${item.endMs}, ${item.width}, ${item.height},
                   ${command.now}, expires_at
            from analyses
            where id = ${target.analysis_id}
          `);
        }

        await transaction.execute(sql`
          update analyses
          set status = 'CANDIDATES_READY',
              pipeline_version = ${payload.pipelineVersion},
              limitations = ${JSON.stringify(payload.limitations)}::jsonb,
              state_version = state_version + 1,
              completed_at = null
          where id = ${target.analysis_id}
        `);
        await transaction.execute(sql`
          update processing_jobs
          set status = 'SUCCEEDED', stage = 'SUCCEEDED', progress_percent = 100,
              heartbeat_at = ${command.now}, lease_owner = null, lease_token_hash = null,
              lease_until = null, failure_code = null, retryable = null, updated_at = ${command.now}
          where id = ${target.id}
        `);
        await transaction.execute(sql`
          insert into processing_job_events (
            job_id, job_revision, attempt, event_type, stage, progress_percent, created_at
          ) values (
            ${target.id}, ${target.job_revision}, ${target.attempt},
            'SUCCEEDED', 'SUCCEEDED', 100, ${command.now}
          )
        `);
        return [{ kind: "ACCEPTED" }];
      });
    } else {
      const payload = command.payload;
      rows = await this.client.db.transaction(async (transaction) => transaction.execute(sql`
          with target as materialized (
            select id, status, job_revision, attempt, lease_owner,
                   lease_token_hash, lease_until, video_asset_id, analysis_id
            from processing_jobs
            where id = ${command.jobId}
            for update
          ), accepted as (
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
            from target
            where job.id = target.id
              and target.status = 'PROCESSING'
              and target.job_revision = ${command.jobRevision}
              and target.lease_owner = ${command.workerId}
              and target.lease_token_hash = ${lease}
              and target.lease_until > ${command.now}
            returning job.id, job.video_asset_id, job.analysis_id, job.job_revision, job.attempt
          ), asset as (
            update video_assets as video
            set status = 'REJECTED',
                state_version = video.state_version + 1,
                validation_error_code = ${payload.failureCode}
            from accepted
            where video.id = accepted.video_asset_id
            returning video.id
          ), analysis as (
            update analyses as item
            set status = 'FAILED',
                failure_code = ${payload.failureCode},
                state_version = item.state_version + 1
            from accepted
            where item.id = accepted.analysis_id
            returning item.id
          ), event as (
            insert into processing_job_events (
              job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at
            )
            select id, job_revision, attempt, 'FAILED', 'FAILED', 100,
                   ${payload.failureCode}, ${command.now}
            from accepted
            returning job_id
          )
          select case
            when exists(select 1 from event) then 'ACCEPTED'
            when not exists(select 1 from target) then 'NOT_FOUND'
            when (select status from target) <> 'PROCESSING' then 'ALREADY_FINISHED'
            else 'STALE_LEASE'
          end as kind
        `));
    }

    const [row] = rows as unknown as Array<{ kind: JobResult["kind"] }>;
    return row ?? { kind: "NOT_FOUND" };
  }

  public async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
    const rows = await this.client.db.execute(sql`
      select analysis_id
      from processing_jobs
      where id = ${command.jobId}
        and job_type = 'ANALYZE_VIDEO'
        and analysis_id is not null
        and status = 'PROCESSING'
        and job_revision = ${command.jobRevision}
        and lease_owner = ${command.workerId}
        and lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
        and lease_until > ${command.now}
      limit 1
    `);
    const [row] = rows as unknown as Array<{ analysis_id: string }>;
    if (row) return { kind: "AUTHORIZED", analysisId: row.analysis_id };
    const jobs = await this.client.db.execute(sql`
      select status from processing_jobs where id = ${command.jobId} limit 1
    `);
    const [job] = jobs as unknown as Array<{ status: string }>;
    if (!job) return { kind: "NOT_FOUND" };
    return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
  }
}

// 작업 저장소 생성
export const jobRepo = (client: DatabaseHandle): JobRepo => new JobRepo(client);
