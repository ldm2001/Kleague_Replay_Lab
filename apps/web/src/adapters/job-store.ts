// 비밀 토큰과 파일 해시의 암호 기능 가져옴
import { createHash as digest, randomBytes } from "node:crypto";
// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
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
    EvidenceStore as EvidencePort
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";
// 자동 평가의 경기 문맥과 증거 연결 기능 가져옴
import { validAutomaticBatch, type AutomaticEvidenceBinding } from "./binding";
// 공유 자료 계약과 검증 기능 가져옴
import type { AutomaticRuleContext } from "../shared/review";
// 규정 자료와 평가 기능 가져옴
import { perceptionModelPins } from "@replay/rule-engine";
// 자동 평가의 경기 문맥과 증거 연결 기능 가져옴
import { automaticContext } from "./automatic-context";
// 원본 해시에 대응하는 검증된 경기 문맥 가져옴
import { knownVideoSource } from "./sources";
import { incidentRows } from "./incidents";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;
// 저장 직전 실제 시각을 읽는 시계 함수 정의
type WallClock = () => Date;
// 비공개 요약의 저장 용량 상한 지정
const MAX_PRIVATE_SUMMARY_BYTES = 1_048_576;
// 저장 거부 결과를 보존하여 트랜잭션 전체를 되돌리는 오류 정의
class RejectedAnalysisWrite extends Error {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(public readonly result: JobResult) {
        // 저장 거부 시 트랜잭션 전체를 되돌릴 오류 내용 초기화
        super("Analysis write rejected; transaction must roll back");
    }
}

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
}>;

// 작업 저장소 어댑터
export class JobStore implements JobPort, ProgressPort, ResultPort, EvidencePort {
    // 저장소 연결과 저장 직전 만료 검사 시계 주입
    public constructor(
        private readonly client: DatabaseHandle,
        private readonly wallClock: WallClock = () => new Date()
    ) {}

    // 처리할 작업 선점과 임대 발급
    public async claim(command: JobClaimCommand): Promise<JobClaim | null> {
        // 작업 임대 토큰 생성
        const leaseToken = randomBytes(32).toString("base64url");
        // 작업 임대 토큰 해시
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
            stage: row.stage as JobClaim["stage"],
            // 작업 진행률의 백분율
            progressPercent: row.progress_percent,
            // 현재 작업 임대를 증명하는 비밀 토큰
            leaseToken,
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

    // 진행 처리
    public async progress(command: JobProgressCommand): Promise<JobProgress> {
        // 진행 상태 갱신 트랜잭션
        const rows = await this.client.db.transaction(async (transaction) =>
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
        const jobs = await this.client.db.execute(
            sql`select id from processing_jobs where id = ${command.jobId}`
        );
        // 작업 임대 오류 결과
        return jobs.length > 0 ? { kind: "STALE_LEASE" } : { kind: "NOT_FOUND" };
    }

    // 결과 제출 전 임대·원본·경기 문맥 확인
    public async preflight(command: JobResultPreflightCommand): Promise<JobResultPreflight> {
        // 현재 임대에 허용된 원본과 분석 및 규정 문맥 조회
        const rows = await this.client.db.execute(sql`
      select job.analysis_id, video.content_sha256, analysis.source_fingerprint,
             analysis.expires_at, analysis.match_id, rule.id as rule_version_id,
             rule.verification_status, rule.ifab_edition, rule.competition, rule.season, video.duration_ms,
             fixture.match_date::text as match_date
      from processing_jobs as job
      join analyses as analysis on analysis.id = job.analysis_id
      join video_assets as video on video.id = analysis.video_asset_id
      left join competition_rule_versions as rule on rule.id = analysis.applied_rule_version_id
      left join matches as fixture on fixture.id = analysis.match_id
      where job.id = ${command.jobId}
        and job.job_type = 'ANALYZE_VIDEO'
        and job.status = 'PROCESSING'
        and job.job_revision = ${command.jobRevision}
        and job.lease_owner = ${command.workerId}
        and job.lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
        and job.lease_until > ${command.now}
      limit 1
    `);
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [row] = rows as unknown as Array<{
            // 분석 기록의 식별자
            analysis_id: string;
            // 파일 내용의 동일성을 대조하는 해시
            content_sha256: Buffer | null;
            // 분석 대상 원본과의 일치 확인용 해시
            source_fingerprint: Buffer | null;
            // 접근과 보존을 허용하는 만료 시각
            expires_at: string | null;
            // 검증된 경기 기록의 식별자
            match_id: string | null;
            // 대회 규정 판본 식별자
            rule_version_id: string | null;
            // 규정 문맥의 검증 상태
            verification_status: string | null;
            // 국제 축구 규정의 판본
            ifab_edition: string | null;
            // 규정 적용 대상 대회
            competition: string | null;
            // 규정 적용 대상 시즌
            season: string | null;
            // 영상 전체 길이의 밀리초 값
            duration_ms: number | null;
            match_date?: string | null;
        }>;
        // 유효한 작업 임대와 원본 문맥 조회 성공 여부 확인
        if (row) {
            // 경기 연결이 없는 등록 원본에 대해서만 자동 문맥 연결 시도
            if (
                !row.match_id &&
                !row.rule_version_id &&
                row.content_sha256 &&
                knownVideoSource(row.content_sha256.toString("hex"))
            ) {
                // 잠금 안에서 등록 원본의 경기와 규정 문맥 연결 시도
                const linked = await this.client.db.transaction(async (transaction) => {
                    // 임대와 원본 유효 기한 재검사에 사용할 실제 시각 읽음
                    const now = this.wallClock().toISOString();
                    // 현재 임대와 보존 기한을 충족한 분석 및 원본 잠금 조회
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
                    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
                    const [target] = locked as unknown as Array<{
                        // 다른 기록과 구별하는 고유 식별자
                        id: string;
                        // 파일 내용의 동일성을 대조하는 해시
                        content_sha256: Buffer;
                    }>;
                    // 잠금 시점에 접근 대상이 사라지면 연결 중단
                    if (!target) return false;
                    // 원본 해시와 등록 경기의 정확한 일치 문맥 조회
                    const context = await automaticContext(
                        target.content_sha256.toString("hex"),
                        (statement) => transaction.execute(statement)
                    );
                    // 검증된 경기 문맥이 없으면 추정 연결 차단
                    if (!context) return false;
                    // 문맥 저장 직전의 실제 시각 읽음
                    const saveNow = this.wallClock().toISOString();
                    // 유효 기한을 다시 확인한 뒤 경기와 규정 연결 저장
                    const saved =
                        await transaction.execute(sql`update analyses set match_id = ${context.matchId}, applied_rule_version_id = ${context.ruleId},
            state_version = state_version + 1 where id = ${target.id} and expires_at > ${saveNow}
              and exists(select 1 from processing_jobs where id = ${command.jobId} and lease_until > ${saveNow}) returning id`);
                    // 유효 기한 재검사 후 실제 연결한 행의 존재 여부 반환
                    return saved.length === 1;
                });
                // 새로 연결된 문맥이 있으면 사전 검사 다시 실행
                if (linked) return this.preflight(command);
            }
            // 현재 임대에 허용된 원본 해시와 경기 규정 문맥 반환
            return {
                // 처리 분기 또는 자료 종류를 구별하는 값
                kind: "AUTHORIZED",
                // 분석 기록의 식별자
                analysisId: row.analysis_id,
                // 분석한 원본 영상의 내용 해시
                sourceSha256: Uint8Array.from(row.content_sha256 ?? []),
                // 분석 기록이 보존한 원본 해시
                analysisSourceSha256: Uint8Array.from(row.source_fingerprint ?? []),
                // 접근과 보존을 허용하는 만료 시각
                expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
                // 영상 전체 길이의 밀리초 값
                durationMs: row.duration_ms,
                // 검증된 경기의 적용 규정 판본
                ruleEdition:
                    row.match_id &&
                    row.rule_version_id &&
                    row.verification_status === "VERIFIED" &&
                    row.ifab_edition
                        ? {
                              // 다른 기록과 구별하는 고유 식별자
                              id: row.rule_version_id,
                              // 규정 문맥의 검증 상태
                              verificationStatus: row.verification_status,
                              // 검증된 경기 기록의 식별자
                              matchId: row.match_id,
                              // 국제 축구 규정의 판본
                              ifabEdition: row.ifab_edition,
                              ...(row.competition ? { competition: row.competition } : {}),
                              ...(row.season ? { season: row.season } : {}),
                              ...(row.match_date ? { matchDate: row.match_date } : {})
                          }
                        : null
            };
        }
        // 현재 작업의 존재 여부와 처리 상태 조회
        const jobs = await this.client.db.execute(
            sql`select status from processing_jobs where id = ${command.jobId} limit 1`
        );
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [job] = jobs as unknown as Array<{ status: string }>;
        // 작업 자체가 없으면 부재 결과 반환
        if (!job) return { kind: "NOT_FOUND" };
        // 진행 중 임대 불일치와 이미 종료된 작업을 구분하여 반환
        return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
    }

    // 결과 처리
    public async result(command: JobResultCommand): Promise<JobResult> {
        // 작업자 결과 유형별 저장 분기
        const lease = Buffer.from(command.leaseTokenHash);
        // 작업 결과 저장 응답을 받을 조회 행 목록 마련
        let rows: unknown[];
        // 영상 유효성 검사 성공 결과인지 확인
        if (command.payload.kind === "VALIDATED") {
            // 영상 검증 결과 저장과 분석 작업 생성
            const payload = command.payload;
            // 영상 검증 완료와 후속 분석 작업 생성을 한 묶음으로 저장
            rows = await this.client.db.transaction(async (transaction) =>
                transaction.execute(sql`
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
        `)
            );
        } else if (command.payload.kind === "ANALYZED") {
            // 영상 분석 결과와 증거 저장
            const payload = command.payload;
            // 승인된 로컬 관측 처리 버전인지 확인
            const localPipeline = [
                "video-local-observers-v1",
                "video-local-observers-av-v1"
            ].includes(payload.pipelineVersion);
            // 사실 채택과 별개인 모델 관측 실행 자료 읽음
            const perception = localPipeline ? payload.perception : undefined;
            // 로컬 관측 자료와 서버 검증 및 버전 대응이 없으면 저장 거부
            if (
                localPipeline &&
                (!perception ||
                    !command.perceptionVerification ||
                    perception.schemaVersion !==
                        (payload.pipelineVersion === "video-local-observers-v1"
                            ? "perception-run-v1"
                            : "perception-run-v2"))
            ) {
                // 작업과 관측 검증 문맥 불일치 결과 반환
                return { kind: "INVALID_RESULT", reason: "CONTEXT" };
            }
            // 비관측 경로에 관측 검증 결과가 섞이면 저장 거부
            if (!localPipeline && command.perceptionVerification) {
                // 처리 경로와 검증 자료의 불일치 결과 반환
                return { kind: "INVALID_RESULT", reason: "CONTEXT" };
            }
            // 직렬화한 비공개 관측 요약의 보관 위치 마련
            let privateSummaryJson: string | undefined;
            // 관측 자료와 서버 검증이 함께 있을 때 비공개 요약 구성
            if (perception && command.perceptionVerification) {
                // 비공개 요약 직렬화 실패를 결과 거부로 처리하는 예외 경계 설정
                try {
                    // 처리 범위와 사건 및 사실 채택 상태를 비공개 요약으로 직렬화
                    privateSummaryJson = JSON.stringify({
                        ...perception.summary,
                        // 사실 채택과 구분한 인식 처리 완료 상태
                        processingStatus: perception.processingStatus,
                        // 인식 처리의 시간 범위와 표본 처리 집계
                        coverage: perception.coverage,
                        // 인식한 사건 후보와 증거 연결 목록
                        incidents: perception.incidents,
                        ...(perception.schemaVersion === "perception-run-v2"
                            ? { audio: perception.audio }
                            : {}),
                        // 관측을 규정 사실로 채택할 수 있는지의 검사 결과
                        admission: command.perceptionVerification.admission
                    });
                } catch {
                    // 직렬화할 수 없는 관측 요약의 저장 거부 반환
                    return { kind: "INVALID_RESULT", reason: "CONTEXT" };
                }
                // 비공개 요약의 실제 바이트 크기가 저장 상한을 넘는지 확인
                if (Buffer.byteLength(privateSummaryJson, "utf8") > MAX_PRIVATE_SUMMARY_BYTES) {
                    // 비공개 요약 용량 초과에 따른 저장 거부 반환
                    return { kind: "INVALID_RESULT", reason: "CONTEXT" };
                }
            }
            // 작업 원본과 평가를 잠금 안에서 다시 확인한 뒤 한 묶음으로 저장
            rows = await this.client.db
                .transaction(async (transaction) => {
                    // 결과 저장에 필요한 작업 원본 분석의 현재 행 잠금 조회
                    const selected = await transaction.execute(sql`
          select job.id, job.status, job.job_type, job.job_revision, job.attempt, job.lease_owner,
                 job.lease_token_hash, job.lease_until, job.analysis_id,
                 analysis.source_fingerprint, analysis.expires_at, video.content_sha256,
                 video.status as video_status, video.expires_at as video_expires_at,
                 analysis.match_id, analysis.applied_rule_version_id
          from processing_jobs as job
          join analyses as analysis on analysis.id = job.analysis_id
          join video_assets as video on video.id = analysis.video_asset_id
          where job.id = ${command.jobId}
          for update of job, analysis, video
        `);
                    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
                    const [target] = selected as unknown as Array<{
                        // 다른 기록과 구별하는 고유 식별자
                        id: string;
                        // 처리 상태 또는 요청 응답 상태
                        status: string;
                        // 영상 검증과 분석의 작업 구분
                        job_type: string;
                        // 재실행 이전 요청을 구분하는 작업 판본
                        job_revision: number;
                        // 현재 작업 실행 시도 횟수
                        attempt: number;
                        // 현재 작업을 임대한 작업자 식별자
                        lease_owner: string | null;
                        // 작업 임대 권한 비교용 토큰 해시
                        lease_token_hash: Buffer | null;
                        // 현재 작업 임대의 유효 기한
                        lease_until: string | null;
                        // 분석 기록의 식별자
                        analysis_id: string | null;
                        // 분석 대상 원본과의 일치 확인용 해시
                        source_fingerprint: Buffer | null;
                        // 파일 내용의 동일성을 대조하는 해시
                        content_sha256: Buffer | null;
                        // 접근과 보존을 허용하는 만료 시각
                        expires_at: string | null;
                        // 검증된 경기 기록의 식별자
                        match_id: string | null;
                        // 분석에 연결한 대회 규정 판본 식별자
                        applied_rule_version_id: string | null;
                        video_status?: string;
                        video_expires_at?: string | null;
                    }>;
                    // 작업 대상이 없으면 결과 저장 중단
                    if (!target) return [{ kind: "NOT_FOUND" }];
                    // 완료된 작업은 중복 결과 차단
                    if (target.status !== "PROCESSING") return [{ kind: "ALREADY_FINISHED" }];
                    // 새 관측 경로는 행 잠금 대기 이후의 실제 벽시계로 작업 임대와 보존 기한을 다시 확인
                    let lockedNow =
                        perception || command.automaticReview
                            ? this.wallClock().toISOString()
                            : command.now;
                    // 현재 작업자 작업 임대 확인
                    const validLease =
                        target.job_type === "ANALYZE_VIDEO" &&
                        target.analysis_id !== null &&
                        target.job_revision === command.jobRevision &&
                        target.lease_owner === command.workerId &&
                        target.lease_token_hash !== null &&
                        Buffer.compare(target.lease_token_hash, lease) === 0 &&
                        target.lease_until !== null &&
                        new Date(target.lease_until).getTime() > new Date(lockedNow).getTime();
                    // 현재 시각에 임대 권한이 유효하지 않으면 결과 저장 차단
                    if (!validLease) return [{ kind: "STALE_LEASE" }];

                    // 새 비공개 관측은 원본 자체의 상태와 보존 기한도 확인한 뒤 저장
                    const privateSourceValid = () => !command.privateIncidents || (
                        target.video_status === "VALID" && target.video_expires_at != null
                        && new Date(target.video_expires_at).getTime() > new Date(lockedNow).getTime()
                    );
                    if (!privateSourceValid()) return [{ kind: "INVALID_RESULT", reason: "SOURCE" }];

                    // 서버 검증이 있는 관측 결과의 원본 동일성 재검사
                    if (perception && command.perceptionVerification) {
                        // 서버가 검증한 원본 해시를 저장 값 비교용 바이트로 변환
                        const verified = Buffer.from(command.perceptionVerification.sourceSha256);
                        // 원본 해시와 분석 소유 관계 및 보존 기한 일치 확인
                        const sourceMatches =
                            command.perceptionVerification.analysisId === target.analysis_id &&
                            verified.length === 32 &&
                            target.source_fingerprint?.length === 32 &&
                            target.content_sha256?.length === 32 &&
                            Buffer.compare(target.source_fingerprint, verified) === 0 &&
                            Buffer.compare(target.content_sha256, verified) === 0 &&
                            target.expires_at !== null &&
                            new Date(target.expires_at).getTime() > new Date(lockedNow).getTime();
                        // 검증한 원본과 저장된 분석 원본이 다르면 결과 거부
                        if (!sourceMatches) return [{ kind: "INVALID_RESULT", reason: "SOURCE" }];
                    }

                    // 중복 검사와 증거 연결 검증에 사용할 후보 순번 집합 생성
                    const candidateIndices = new Set(payload.candidates.map((item) => item.index));
                    // 화면 구간 순번의 중복 검사 집합 생성
                    const shotIndices = new Set(payload.shots.map((item) => item.index));
                    // 증거 파일 경로의 중복 검사 집합 생성
                    const evidenceObjectKeys = new Set(
                        (payload.evidence ?? []).map((item) => item.objectKey)
                    );
                    // 현재 분석과 작업에 허용된 증거 경로 앞부분 생성
                    const evidencePrefix = `evidence/${target.analysis_id}/${target.id}/`;
                    // 후보와 화면 구간 및 증거의 중복과 다른 작업 증거 참조 차단
                    if (
                        candidateIndices.size !== payload.candidates.length ||
                        shotIndices.size !== payload.shots.length ||
                        evidenceObjectKeys.size !== (payload.evidence ?? []).length ||
                        (payload.evidence ?? []).some(
                            (item) =>
                                !item.objectKey.startsWith(evidencePrefix) ||
                                !candidateIndices.has(item.candidateIndex)
                        )
                    ) {
                        // 후보와 증거 연결 문맥의 부적합 결과 반환
                        return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
                    }

                    // 후보별 자동 규정 평가 자료 준비
                    const automatic = command.automaticReview;
                    // 자동 평가가 포함된 경우 현재 경기 규정 문맥 추가 검사
                    if (automatic) {
                        // 경기 날짜와 대회 및 시즌에 맞는 검증된 규정 판본 조회
                        const rules =
                            target.applied_rule_version_id && target.match_id
                                ? await transaction.execute(sql`
            select rule.id, rule.competition, rule.season, rule.ifab_edition, rule.verification_status
            from competition_rule_versions as rule
            join matches as match on match.id = ${target.match_id}
              and match.competition = rule.competition and match.season = rule.season
              and match.match_date >= rule.effective_from
              and (rule.effective_to is null or match.match_date <= rule.effective_to)
            where rule.id = ${target.applied_rule_version_id} and nullif(trim(rule.source_document), '') is not null
            for share of rule, match
          `)
                                : [];
                        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
                        const [rule] = rules as unknown as Array<{
                            // 다른 기록과 구별하는 고유 식별자
                            id: string;
                            // 규정 적용 대상 대회
                            competition: string;
                            // 규정 적용 대상 시즌
                            season: string;
                            // 국제 축구 규정의 판본
                            ifab_edition: string;
                            // 규정 문맥의 검증 상태
                            verification_status: string;
                        }>;
                        // 검증된 경기와 판본이 모두 있을 때만 규정 문맥 생성
                        const currentRule: AutomaticRuleContext | null =
                            rule?.verification_status === "VERIFIED" && target.match_id
                                ? {
                                      // 다른 기록과 구별하는 고유 식별자
                                      id: rule.id,
                                      // 검증된 경기 기록의 식별자
                                      matchId: target.match_id,
                                      // 규정 적용 대상 대회
                                      competition: rule.competition,
                                      // 규정 적용 대상 시즌
                                      season: rule.season,
                                      // 국제 축구 규정 판본 식별자
                                      ifabVersionId: `ifab-${rule.ifab_edition}`,
                                      // 규정 문맥의 검증 상태
                                      verificationStatus: "VERIFIED"
                                  }
                                : null;
                        // 완료 평가가 있다면 승인된 고정 모델 출처가 모두 존재하는지 확인
                        if (
                            automatic.rows.some((row) => row.status === "COMPLETED") &&
                            (!perception ||
                                Object.values(perceptionModelPins).some(
                                    (pin) =>
                                        !perception.models.some(
                                            (model) =>
                                                model.component === pin.component &&
                                                model.modelId === pin.modelId &&
                                                model.revision === pin.revision &&
                                                model.weightsSha256 === pin.weightsSha256
                                        )
                                ))
                        ) {
                            // 고정 모델 출처를 충족하지 못한 완료 결과 거부 반환
                            return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
                        }
                        // 원본 보존 기한과 해시 및 자동 평가 계약과 용량 재검사
                        if (
                            !target.source_fingerprint ||
                            !target.content_sha256 ||
                            !target.source_fingerprint.equals(target.content_sha256) ||
                            !target.expires_at ||
                            new Date(target.expires_at).getTime() <=
                                new Date(lockedNow).getTime() ||
                            !validAutomaticBatch(automatic, {
                                // 분석 기록의 식별자
                                analysisId: target.analysis_id!,
                                // 처리 작업의 식별자
                                jobId: target.id,
                                // 재실행 이전 요청을 구분하는 작업 판본
                                jobRevision: target.job_revision,
                                // 분석한 원본 영상의 내용 해시
                                sourceSha256: target.source_fingerprint.toString("hex"),
                                // 영상 처리 절차를 구별하는 버전
                                pipelineVersion: payload.pipelineVersion,
                                // 분석에 속한 후보 장면 순번 집합
                                candidateIndices: [...candidateIndices],
                                // 원본에 연결한 증거 자료 또는 접근 기능
                                evidence: payload.evidence ?? [],
                                // 경기 문맥에 맞춰 연결한 규정 자료
                                rule: currentRule
                            }) ||
                            Buffer.byteLength(JSON.stringify(automatic), "utf8") >
                                MAX_PRIVATE_SUMMARY_BYTES
                        ) {
                            // 자동 평가 저장 문맥의 부적합 결과 반환
                            return [{ kind: "INVALID_RESULT", reason: "CONTEXT" }];
                        }
                    }

                    // 검증용 잠금 확보 후 실제 저장 시점의 유효 기한 갱신
                    const expiryFailure = (): JobResult | null => {
                        // 관측과 자동 평가가 모두 없으면 추가 기한 검사 생략
                        if (!perception && !automatic) return null;
                        // 임대와 원본 유효 기한 재검사에 사용할 실제 시각 읽음
                        const now = this.wallClock().getTime();
                        // 저장 시점의 작업 임대 만료 여부 확인
                        if (!target.lease_until || new Date(target.lease_until).getTime() <= now)
                            // 쓰기 중 임대 만료 결과 반환
                            return { kind: "STALE_LEASE" };
                        // 저장 시점의 원본 보존 기한 만료 여부 확인
                        if (!target.expires_at || new Date(target.expires_at).getTime() <= now)
                            // 만료된 원본을 사용하는 결과 저장 거부 반환
                            return { kind: "INVALID_RESULT", reason: "SOURCE" };
                        // 이후 저장 시각을 실제 검사 시각으로 갱신
                        lockedNow = new Date(now).toISOString();
                        // 부분 쓰기 이후 원본 기한을 넘겼으면 비공개 관측까지 전체 롤백
                        if (!privateSourceValid()) return { kind: "INVALID_RESULT", reason: "SOURCE" };
                        // 임대와 원본 기한 검사에서 실패 없음 반환
                        return null;
                    };
                    // 실제 쓰기 직전 임대와 원본 유효 기한 재검사
                    const beforeWriteFailure = expiryFailure();
                    // 저장 직전 기한 검사 실패 시 쓰기 시작 차단
                    if (beforeWriteFailure) return [beforeWriteFailure];

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
              'UNREVIEWED', ${lockedNow}
            )
          `);
                    }

                    // 후보별 증거 자산 저장
                    const evidenceBindings: AutomaticEvidenceBinding[] = [];
                    // 제출 증거 순번을 유지하며 후보별 자산 저장 반복
                    for (const [evidenceIndex, item] of (payload.evidence ?? []).entries()) {
                        // 저장 증거와 연결할 현재 분석의 후보 식별자 조회
                        const candidates = await transaction.execute(sql`
            select id
            from incident_candidates
            where analysis_id = ${target.analysis_id}
              and candidate_index = ${item.candidateIndex}
            limit 1
          `);
                        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
                        const [candidate] = candidates as unknown as Array<{ id: string }>;
                        // 증거가 참조한 후보가 없으면 전체 저장 취소
                        if (!candidate)
                            // 잘못된 후보 증거 연결을 오류로 전달하여 트랜잭션 되돌림
                            throw new RejectedAnalysisWrite({
                                // 처리 분기 또는 자료 종류를 구별하는 값
                                kind: "INVALID_RESULT",
                                // 입력 거부 또는 처리 보류 사유
                                reason: "CONTEXT"
                            });
                        // 후보와 원본 시간축을 연결한 증거 자산 저장
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
                        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
                        const [savedEvidence] = insertedEvidence as unknown as Array<{
                            // 다른 기록과 구별하는 고유 식별자
                            id: string;
                        }>;
                        // 증거 자산 저장 식별자를 얻은 경우에만 연결 기록 추가
                        if (savedEvidence)
                            // 제출 순번과 저장된 증거 식별자의 대응 관계 보존
                            evidenceBindings.push({
                                ...item,
                                // 제출 목록에서 증거를 찾는 순번
                                evidenceIndex,
                                // 저장된 증거 자산의 식별자
                                evidenceId: savedEvidence.id
                            });
                    }

                    // 자동 평가가 있는 경우 증거 연결과 함께 보존
                    if (automatic) {
                        // 저장된 증거 개수와 연결 요약 용량의 계약 위반 확인
                        if (
                            evidenceBindings.length !== (payload.evidence ?? []).length ||
                            Buffer.byteLength(JSON.stringify(evidenceBindings), "utf8") >
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
              ${JSON.stringify(evidenceBindings)}::jsonb, ${lockedNow}, ${target.expires_at})
          `);
                    }

                    // 관측과 서버 검증이 함께 있는 경우 비공개 실행 이력 보존
                    if (perception && command.perceptionVerification) {
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
              ${privateSummaryJson!}::jsonb, ${lockedNow}, ${target.expires_at}
            )
          `);
                    }

                    // 기존 결과와 같은 트랜잭션에서 일반 관측과 유형별 사건을 비공개 저장
                    if (command.privateIncidents) {
                        if (!perception || !command.perceptionVerification || !target.expires_at) {
                            throw new Error("INCIDENT_VERIFICATION_REQUIRED");
                        }
                        await incidentRows(transaction, command.privateIncidents, {
                            analysisId: target.analysis_id!, jobId: target.id, jobRevision: target.job_revision,
                            sourceSha256: Buffer.from(target.source_fingerprint!).toString("hex"),
                            artifactSha256: perception.artifact.contentSha256,
                            now: lockedNow, expiresAt: new Date(target.expires_at).toISOString(),
                            evidence: payload.evidence ?? []
                        });
                    }

        // 영상 처리 완료와 규정 판단 가능 여부의 독립 처리
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
                    // 완료·이벤트 저장을 포함한 모든 쓰기 중 기한 만료 시 전체 묶음 되돌림
                    const afterWriteFailure = expiryFailure();
                    // 모든 쓰기 후 기한이 만료되었으면 전체 트랜잭션 취소
                    if (afterWriteFailure) throw new RejectedAnalysisWrite(afterWriteFailure);
                    // 모든 검증과 저장을 통과한 접수 결과 반환
                    return [{ kind: "ACCEPTED" }];
                })
                .catch((error: unknown) => {
                    // 의도된 저장 거부 오류는 보존한 실패 결과로 변환
                    if (error instanceof RejectedAnalysisWrite) return [error.result];
                    // 예상하지 못한 저장 오류를 상위 호출로 전달
                    throw error;
                });
        } else {
            // 작업자 실패 결과 저장
            const payload = command.payload;
            // 작업자 실패와 영상 및 분석 실패 상태를 함께 저장
            rows = await this.client.db.transaction(async (transaction) =>
                transaction.execute(sql`
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
        `)
            );
        }

        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [row] = rows as unknown as Array<JobResult>;
        // 저장 결과 반환
        return row ?? { kind: "NOT_FOUND" };
    }

    // 작업 임대에 따른 원본 접근 확인
    public async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
        // 현재 작업 임대가 증거 업로드 권한을 가지는지 확인
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
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [row] = rows as unknown as Array<{ analysis_id: string }>;
        // 유효한 작업 임대면 분석 식별자 반환
        if (row) return { kind: "AUTHORIZED", analysisId: row.analysis_id };
        // 작업 상태 확인
        const jobs = await this.client.db.execute(sql`
      select status from processing_jobs where id = ${command.jobId} limit 1
    `);
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [job] = jobs as unknown as Array<{ status: string }>;
        // 작업이 없으면 접근 실패
        if (!job) return { kind: "NOT_FOUND" };
        // 처리 중이면 작업 임대 만료 결과 반환
        return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
    }
}

// 작업 저장소 생성
export const jobStore = (client: DatabaseHandle): JobStore => new JobStore(client);
