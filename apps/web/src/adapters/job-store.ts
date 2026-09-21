import { createHash as digest, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  JobClaim,
  JobClaimCommand,
  JobProgress,
  JobProgressCommand,
  JobProgressStore as ProgressPort,
  JobStore as JobPort,
  JobResult,
  JobResultCommand,
  JobResultPreflight,
  JobResultPreflightCommand,
  JobResultStore as ResultPort,
  JobStage,
  JobType,
  EvidenceAccess,
  EvidenceAccessCommand,
  EvidenceStore as EvidencePort,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";
import { validAutomaticBatch, type AutomaticEvidenceBinding } from "./automatic-review-binding";
import type { AutomaticRuleContext } from "../shared/automatic-review";
import { perceptionModelPins } from "@replay/rule-engine";
import { automaticContext } from "./automatic-context";
import { knownVideoSource } from "./known-video-sources";

type DatabaseHandle = Pick<DatabaseClient, "db">;
type WallClock = () => Date;
const MAX_PRIVATE_SUMMARY_BYTES = 1_048_576;
class RejectedAnalysisWrite extends Error {
  public constructor(public readonly result: JobResult) { super("Analysis write rejected; transaction must roll back"); }
}

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
export class JobStore implements JobPort, ProgressPort, ResultPort, EvidencePort {
  public constructor(
    private readonly client: DatabaseHandle,
    private readonly wallClock: WallClock = () => new Date(),
  ) {}

  public async claim(command: JobClaimCommand): Promise<JobClaim | null> {
    // Lease 토큰 생성
    const leaseToken = randomBytes(32).toString("base64url");
    // Lease 토큰 해시
    const leaseTokenHash = digest("sha256").update(leaseToken, "utf8").digest();

    // 작업 선점 트랜잭션
    const rows = await this.client.db.transaction(async (transaction) => {
      // 마지막 시도에서 만료된 작업을 작은 배치로 종료
      await transaction.execute(sql`
        with expired as (
          select id from processing_jobs
          where job_type = ${command.jobType} and status = 'PROCESSING'
            and lease_until <= ${command.now} and attempt >= max_attempts
          order by lease_until, id
          for update skip locked limit 100
        ), failed as (
          update processing_jobs as job
          set status = 'FAILED', stage = 'FAILED', failure_code = 'WORKER_TIMEOUT',
              retryable = false, lease_owner = null, lease_token_hash = null,
              lease_until = null, updated_at = ${command.now}
          from expired where job.id = expired.id
          returning job.id, job.analysis_id, job.video_asset_id, job.job_type,
                    job.job_revision, job.attempt, job.progress_percent
        ), videos as (
          update video_assets as video
          set status = 'REJECTED', validation_error_code = 'WORKER_TIMEOUT',
              state_version = video.state_version + 1
          from failed
          where video.id = failed.video_asset_id and failed.job_type = 'VALIDATE_VIDEO'
            and video.status = 'VALIDATING'
          returning video.id
        ), analyses as (
          update analyses as analysis
          set status = 'FAILED', failure_code = 'WORKER_TIMEOUT',
              state_version = analysis.state_version + 1
          from failed
          where analysis.id = failed.analysis_id and failed.job_type = 'ANALYZE_VIDEO'
            and analysis.status not in ('COMPLETED', 'FAILED')
          returning analysis.id
        )
        insert into processing_job_events (job_id, job_revision, attempt, event_type, stage, progress_percent, message, created_at)
        select id, job_revision, attempt, 'FAILED', 'FAILED', progress_percent,
               'WORKER_TIMEOUT', ${command.now} from failed
      `);
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

  public async preflight(command: JobResultPreflightCommand): Promise<JobResultPreflight> {
    const rows = await this.client.db.execute(sql`
      select job.analysis_id, video.content_sha256, analysis.source_fingerprint,
             analysis.expires_at, analysis.match_id, rule.id as rule_version_id,
             rule.verification_status, rule.ifab_edition, rule.competition, rule.season, video.duration_ms
      from processing_jobs as job
      join analyses as analysis on analysis.id = job.analysis_id
      join video_assets as video on video.id = analysis.video_asset_id
      left join competition_rule_versions as rule on rule.id = analysis.applied_rule_version_id
      where job.id = ${command.jobId}
        and job.job_type = 'ANALYZE_VIDEO'
        and job.status = 'PROCESSING'
        and job.job_revision = ${command.jobRevision}
        and job.lease_owner = ${command.workerId}
        and job.lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
        and job.lease_until > ${command.now}
      limit 1
    `);
    const [row] = rows as unknown as Array<{
      analysis_id: string;
      content_sha256: Buffer | null;
      source_fingerprint: Buffer | null;
      expires_at: string | null;
      match_id: string | null;
      rule_version_id: string | null;
      verification_status: string | null;
      ifab_edition: string | null;
      competition: string | null;
      season: string | null;
      duration_ms: number | null;
    }>;
    if (row) {
      if (!row.match_id && !row.rule_version_id && row.content_sha256 && knownVideoSource(row.content_sha256.toString("hex"))) {
        const linked = await this.client.db.transaction(async (transaction) => {
          const now = this.wallClock().toISOString();
          const locked = await transaction.execute(sql`
            select analysis.id, video.content_sha256
            from processing_jobs as job join analyses as analysis on analysis.id = job.analysis_id
            join video_assets as video on video.id = analysis.video_asset_id
            where job.id = ${command.jobId} and job.job_type = 'ANALYZE_VIDEO' and job.status = 'PROCESSING'
              and job.job_revision = ${command.jobRevision} and job.lease_owner = ${command.workerId}
              and job.lease_token_hash = ${Buffer.from(command.leaseTokenHash)} and job.lease_until > ${now}
              and analysis.expires_at > ${now} and analysis.match_id is null and analysis.applied_rule_version_id is null
              and analysis.source_fingerprint = video.content_sha256
              and video.content_sha256 = ${row.content_sha256}
            for update of job, analysis, video
          `);
          const [target] = locked as unknown as Array<{ id: string; content_sha256: Buffer }>;
          if (!target) return false;
          const context = await automaticContext(target.content_sha256.toString("hex"), (statement) => transaction.execute(statement));
          if (!context) return false;
          const saveNow = this.wallClock().toISOString();
          const saved = await transaction.execute(sql`update analyses set match_id = ${context.matchId}, applied_rule_version_id = ${context.ruleId},
            state_version = state_version + 1 where id = ${target.id} and expires_at > ${saveNow}
              and exists(select 1 from processing_jobs where id = ${command.jobId} and lease_until > ${saveNow}) returning id`);
          return saved.length === 1;
        });
        if (linked) return this.preflight(command);
      }
      return {
        kind: "AUTHORIZED",
        analysisId: row.analysis_id,
        sourceSha256: Uint8Array.from(row.content_sha256 ?? []),
        analysisSourceSha256: Uint8Array.from(row.source_fingerprint ?? []),
        expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
        durationMs: row.duration_ms,
        ruleEdition: row.match_id && row.rule_version_id && row.verification_status === "VERIFIED" && row.ifab_edition
          ? { id: row.rule_version_id, verificationStatus: row.verification_status,
              matchId: row.match_id, ifabEdition: row.ifab_edition, ...(row.competition ? { competition: row.competition } : {}), ...(row.season ? { season: row.season } : {}) }
          : null,
      };
    }
    const jobs = await this.client.db.execute(sql`select status from processing_jobs where id = ${command.jobId} limit 1`);
    const [job] = jobs as unknown as Array<{ status: string }>;
    if (!job) return { kind: "NOT_FOUND" };
    return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
  }

  public async result(command: JobResultCommand): Promise<JobResult> {
    // Worker 결과 유형별 저장 분기
    const lease = Buffer.from(command.leaseTokenHash);
    let rows: unknown[];
    if (command.payload.kind === "VALIDATED") {
      // 영상 검증 결과 저장과 분석 작업 생성
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
            else 'STALE_LEASE'
          end as kind
        `));
    } else if (command.payload.kind === "ANALYZED") {
      // 영상 분석 결과와 증거 저장
      const payload = command.payload;
      const localPipeline = ["video-local-observers-v1", "video-local-observers-av-v1"].includes(payload.pipelineVersion);
      const perception = localPipeline ? payload.perception : undefined;
      if (localPipeline && (!perception || !command.perceptionVerification ||
        perception.schemaVersion !== (payload.pipelineVersion === "video-local-observers-v1" ? "perception-run-v1" : "perception-run-v2"))) {
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
      }
      if (!localPipeline && command.perceptionVerification) {
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
      }
      let privateSummaryJson: string | undefined;
      if (perception && command.perceptionVerification) {
        try {
          privateSummaryJson = JSON.stringify({
            ...perception.summary,
            processingStatus: perception.processingStatus,
            coverage: perception.coverage,
            incidents: perception.incidents,
            ...(perception.schemaVersion === "perception-run-v2" ? { audio: perception.audio } : {}),
            admission: command.perceptionVerification.admission,
          });
        } catch {
          return { kind: "INVALID_RESULT", reason: "CONTEXT" };
        }
        if (Buffer.byteLength(privateSummaryJson, "utf8") > MAX_PRIVATE_SUMMARY_BYTES) {
          return { kind: "INVALID_RESULT", reason: "CONTEXT" };
        }
      }
      rows = await this.client.db.transaction(async (transaction) => {
        const selected = await transaction.execute(sql`
          select job.id, job.status, job.job_type, job.job_revision, job.attempt, job.lease_owner,
                 job.lease_token_hash, job.lease_until, job.analysis_id,
                 analysis.source_fingerprint, analysis.expires_at, video.content_sha256,
                 analysis.match_id, analysis.applied_rule_version_id
          from processing_jobs as job
          join analyses as analysis on analysis.id = job.analysis_id
          join video_assets as video on video.id = analysis.video_asset_id
          where job.id = ${command.jobId}
          for update of job, analysis, video
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
          source_fingerprint: Buffer | null;
          content_sha256: Buffer | null;
          expires_at: string | null;
          match_id: string | null;
          applied_rule_version_id: string | null;
        }>;
        // 작업 대상이 없으면 결과 저장 중단
        if (!target) return [{ kind: "NOT_FOUND" }];
        // 완료된 작업은 중복 결과 차단
        if (target.status !== "PROCESSING") return [{ kind: "ALREADY_FINISHED" }];
        // 새 관측 경로는 행 잠금 대기 이후의 실제 벽시계로 Lease와 보존 기한을 다시 확인한다
        let lockedNow = perception || command.automaticReview ? this.wallClock().toISOString() : command.now;
        // 현재 Worker Lease 확인
        const validLease =
          target.job_type === "ANALYZE_VIDEO" &&
          target.analysis_id !== null &&
          target.job_revision === command.jobRevision &&
          target.lease_owner === command.workerId &&
          target.lease_token_hash !== null &&
          Buffer.compare(target.lease_token_hash, lease) === 0 &&
          target.lease_until !== null &&
          new Date(target.lease_until).getTime() > new Date(lockedNow).getTime();
        if (!validLease) return [{ kind: "STALE_LEASE" }];

        if (perception && command.perceptionVerification) {
          const verified = Buffer.from(command.perceptionVerification.sourceSha256);
          const sourceMatches = command.perceptionVerification.analysisId === target.analysis_id &&
            verified.length === 32 && target.source_fingerprint?.length === 32 && target.content_sha256?.length === 32 &&
            Buffer.compare(target.source_fingerprint, verified) === 0 && Buffer.compare(target.content_sha256, verified) === 0 &&
            target.expires_at !== null && new Date(target.expires_at).getTime() > new Date(lockedNow).getTime();
          if (!sourceMatches) return [{ kind: "INVALID_RESULT", reason: "SOURCE" }];
        }

        const candidateIndices = new Set(payload.candidates.map((item) => item.index));
        const shotIndices = new Set(payload.shots.map((item) => item.index));
        const evidenceObjectKeys = new Set((payload.evidence ?? []).map((item) => item.objectKey));
        const evidencePrefix = `evidence/${target.analysis_id}/${target.id}/`;
        if (candidateIndices.size !== payload.candidates.length || shotIndices.size !== payload.shots.length ||
          evidenceObjectKeys.size !== (payload.evidence ?? []).length || (payload.evidence ?? []).some((item) =>
          !item.objectKey.startsWith(evidencePrefix) || !candidateIndices.has(item.candidateIndex))) {
          return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
        }

        const automatic = command.automaticReview;
        if (automatic) {
          const rules = target.applied_rule_version_id && target.match_id ? await transaction.execute(sql`
            select rule.id, rule.competition, rule.season, rule.ifab_edition, rule.verification_status
            from competition_rule_versions as rule
            join matches as match on match.id = ${target.match_id}
              and match.competition = rule.competition and match.season = rule.season
              and match.match_date >= rule.effective_from
              and (rule.effective_to is null or match.match_date <= rule.effective_to)
            where rule.id = ${target.applied_rule_version_id} and nullif(trim(rule.source_document), '') is not null
            for share of rule, match
          `) : [];
          const [rule] = rules as unknown as Array<{ id: string; competition: string; season: string; ifab_edition: string; verification_status: string }>;
          const currentRule: AutomaticRuleContext | null = rule?.verification_status === "VERIFIED" && target.match_id
            ? { id: rule.id, matchId: target.match_id, competition: rule.competition, season: rule.season, ifabVersionId: `ifab-${rule.ifab_edition}`, verificationStatus: "VERIFIED" } : null;
          if (automatic.rows.some((row) => row.status === "COMPLETED") && (!perception ||
            Object.values(perceptionModelPins).some((pin) => !perception.models.some((model) => model.component === pin.component &&
              model.modelId === pin.modelId && model.revision === pin.revision && model.weightsSha256 === pin.weightsSha256)))) {
            return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
          }
          if (!target.source_fingerprint || !target.content_sha256 || !target.source_fingerprint.equals(target.content_sha256) ||
            !target.expires_at || new Date(target.expires_at).getTime() <= new Date(lockedNow).getTime() ||
            !validAutomaticBatch(automatic, { analysisId: target.analysis_id!, jobId: target.id, jobRevision: target.job_revision,
              sourceSha256: target.source_fingerprint.toString("hex"), pipelineVersion: payload.pipelineVersion,
              candidateIndices: [...candidateIndices], evidence: payload.evidence ?? [], rule: currentRule }) ||
            Buffer.byteLength(JSON.stringify(automatic), "utf8") > MAX_PRIVATE_SUMMARY_BYTES) {
            return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
          }
        }

        // All potentially blocking validation locks are now held. Refresh the write-time boundary.
        const expiryFailure = (): JobResult | null => {
          if (!perception && !automatic) return null;
          const now = this.wallClock().getTime();
          if (!target.lease_until || new Date(target.lease_until).getTime() <= now) return { kind: "STALE_LEASE" };
          if (!target.expires_at || new Date(target.expires_at).getTime() <= now) return { kind: "INVALID_RESULT", reason: "SOURCE" };
          lockedNow = new Date(now).toISOString();
          return null;
        };
        const beforeWriteFailure = expiryFailure();
        if (beforeWriteFailure) return [beforeWriteFailure];

        // 샷 목록 저장
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

        // 후보 장면 목록 저장
        for (const item of payload.candidates) {
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
              'UNREVIEWED', ${lockedNow}
            )
          `);
        }

        // 후보별 증거 자산 저장
        const evidenceBindings: AutomaticEvidenceBinding[] = [];
        for (const [evidenceIndex, item] of (payload.evidence ?? []).entries()) {
          const candidates = await transaction.execute(sql`
            select id
            from incident_candidates
            where analysis_id = ${target.analysis_id}
              and candidate_index = ${item.candidateIndex}
            limit 1
          `);
          const [candidate] = candidates as unknown as Array<{ id: string }>;
          if (!candidate) throw new RejectedAnalysisWrite({ kind: "INVALID_RESULT", reason: "CONTEXT" });
          const insertedEvidence = await transaction.execute(sql`
            insert into evidence_assets (
              analysis_id, incident_candidate_id, kind, object_key, content_sha256,
              start_ms, end_ms, width, height, created_at, expires_at
            )
            select ${target.analysis_id}, ${candidate.id}, ${item.kind}::evidence_kind,
                   ${item.objectKey}, ${Buffer.from(item.contentSha256, "hex")},
                   ${item.startMs}, ${item.endMs}, ${item.width}, ${item.height},
                   ${lockedNow}, expires_at
            from analyses
            where id = ${target.analysis_id}
            returning id
          `);
          const [savedEvidence] = insertedEvidence as unknown as Array<{ id: string }>;
          if (savedEvidence) evidenceBindings.push({ ...item, evidenceIndex, evidenceId: savedEvidence.id });
        }

        if (automatic) {
          if (evidenceBindings.length !== (payload.evidence ?? []).length || Buffer.byteLength(JSON.stringify(evidenceBindings), "utf8") > MAX_PRIVATE_SUMMARY_BYTES) {
            throw new Error("Automatic evidence bindings exceed storage contract");
          }
          await transaction.execute(sql`
            insert into analysis_automatic_reviews (analysis_id, job_id, job_revision, source_sha256,
              evaluator_version, pipeline_version, summary, evidence_bindings, created_at, expires_at)
            values (${target.analysis_id}, ${target.id}, ${target.job_revision}, ${target.source_fingerprint},
              ${automatic.version}, ${payload.pipelineVersion}, ${JSON.stringify(automatic)}::jsonb,
              ${JSON.stringify(evidenceBindings)}::jsonb, ${lockedNow}, ${target.expires_at})
          `);
        }

        if (perception && command.perceptionVerification) {
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
              ${privateSummaryJson!}::jsonb, ${lockedNow}, ${target.expires_at}
            )
          `);
        }

        // 처리 완료는 규정 판단 가능 여부와 독립적이다
        await transaction.execute(sql`
          update analyses
          set status = 'COMPLETED',
              pipeline_version = ${payload.pipelineVersion},
              limitations = ${JSON.stringify(payload.limitations)}::jsonb,
              state_version = state_version + 1,
              completed_at = ${lockedNow}
          where id = ${target.analysis_id}
        `);
        // 분석 작업 완료 처리
        await transaction.execute(sql`
          update processing_jobs
          set status = 'SUCCEEDED', stage = 'SUCCEEDED', progress_percent = 100,
              heartbeat_at = ${lockedNow}, lease_owner = null, lease_token_hash = null,
              lease_until = null, failure_code = null, retryable = null, updated_at = ${lockedNow}
          where id = ${target.id}
        `);
        // 작업 완료 이벤트 기록
        await transaction.execute(sql`
          insert into processing_job_events (
            job_id, job_revision, attempt, event_type, stage, progress_percent, created_at
          ) values (
            ${target.id}, ${target.job_revision}, ${target.attempt},
            'SUCCEEDED', 'SUCCEEDED', 100, ${lockedNow}
          )
        `);
        // Expiry during any write (including completion/event writes) must roll back the entire batch.
        const afterWriteFailure = expiryFailure();
        if (afterWriteFailure) throw new RejectedAnalysisWrite(afterWriteFailure);
        return [{ kind: "ACCEPTED" }];
      }).catch((error: unknown) => {
        if (error instanceof RejectedAnalysisWrite) return [error.result];
        throw error;
      });
    } else {
      // Worker 실패 결과 저장
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

    const [row] = rows as unknown as Array<JobResult>;
    // 저장 결과 반환
    return row ?? { kind: "NOT_FOUND" };
  }

  public async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
    // 현재 Lease가 증거 업로드 권한을 가지는지 확인
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
    // 유효한 Lease면 분석 식별자 반환
    if (row) return { kind: "AUTHORIZED", analysisId: row.analysis_id };
    // 작업 상태 확인
    const jobs = await this.client.db.execute(sql`
      select status from processing_jobs where id = ${command.jobId} limit 1
    `);
    const [job] = jobs as unknown as Array<{ status: string }>;
    // 작업이 없으면 접근 실패
    if (!job) return { kind: "NOT_FOUND" };
    // 처리 중이면 Lease 만료 결과 반환
    return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
  }
}

// 작업 저장소 생성
export const jobStore = (client: DatabaseHandle): JobStore => new JobStore(client);
