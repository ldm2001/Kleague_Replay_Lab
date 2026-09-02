import {
  and,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SubmitAnalysisCommand, SubmitAnalysisRepository, SubmitAnalysisRepositoryResult } from "@replay/application";
import {
  competitionRuleVersions,
  idempotencyRecords,
  matches,
  type DatabaseClient,
} from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type LockedSessionRow = {
  id: string;
};

type LockedVideoRow = {
  id: string;
  anonymous_session_id: string;
  content_sha256: Buffer;
};

const duplicateVideoConstraint = "analyses_video_asset_id_key";

// 중복 영상 오류 확인
const duplicateVideo = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  const constraint = candidate.constraint ?? candidate.constraint_name;
  if (candidate.code === "23505" && constraint === duplicateVideoConstraint) {
    return true;
  }

  return candidate.cause !== undefined && duplicateVideo(candidate.cause);
};

// 분석 저장소 어댑터
export class AnalysisRepo implements SubmitAnalysisRepository {
  public constructor(private readonly client: DatabaseHandle) {}

  public async submit(command: SubmitAnalysisCommand): Promise<SubmitAnalysisRepositoryResult> {
    // 멱등 키 버퍼 변환
    const keyHash = Buffer.from(command.keyHash);
    // 요청 해시 버퍼 변환
    const requestHash = Buffer.from(command.requestHash);
    // 세션과 키 기반 잠금 범위
    const lockScope = `${command.anonymousSessionId}:${keyHash.toString("hex")}`;

    try {
      // 분석 생성 트랜잭션 시작
      return await this.client.db.transaction(async (transaction) => {
        // 동일 요청 잠금
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))`,
        );

        // 기존 멱등 기록 조회
        const [existingIdempotency] = await transaction
          .select({
            requestHash: idempotencyRecords.requestHash,
            analysisId: idempotencyRecords.analysisId,
          })
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.anonymousSessionId, command.anonymousSessionId),
              eq(idempotencyRecords.operation, "CREATE_ANALYSIS"),
              eq(idempotencyRecords.keyHash, keyHash),
            ),
          )
          .limit(1);

        // 기존 멱등 기록 분기
        if (existingIdempotency) {
          // 요청 해시 비교
          return Buffer.compare(existingIdempotency.requestHash, requestHash) === 0
            ? { kind: "REPLAYED", analysisId: existingIdempotency.analysisId }
            : { kind: "IDEMPOTENCY_KEY_REUSED" };
        }

        // 세션 소유권 조회
        const sessionRows = await transaction.execute(sql`
          select id
          from anonymous_sessions
          where id = ${command.anonymousSessionId}
            and revoked_at is null
            and expires_at > ${command.createdAt}
          for update
        `);
        // 세션 행 선택
        const [session] = sessionRows as unknown as LockedSessionRow[];

        // 세션 유효성 확인
        if (!session) {
          return { kind: "VIDEO_ASSET_UNAVAILABLE" };
        }

        // 영상 자산 조회
        const videoRows = await transaction.execute(sql`
          select id, anonymous_session_id, content_sha256
          from video_assets
          where id = ${command.videoAssetId}
            and anonymous_session_id = ${command.anonymousSessionId}
            and status = 'VALID'
            and rights_confirmed_at is not null
            and (expires_at is null or expires_at > ${command.createdAt})
            and object_deleted_at is null
          for update
        `);
        // 영상 행 선택
        const [video] = videoRows as unknown as LockedVideoRow[];

        // 영상 소유권 확인
        if (!video || video.anonymous_session_id !== command.anonymousSessionId) {
          return { kind: "VIDEO_ASSET_UNAVAILABLE" };
        }

        // 경기 조회
        const [match] = await transaction
          .select({
            id: matches.id,
            competition: matches.competition,
            season: matches.season,
            matchDate: matches.matchDate,
          })
          .from(matches)
          .where(eq(matches.id, command.matchId))
          .limit(1);

        // 경기 존재 확인
        if (!match) {
          return { kind: "MATCH_UNAVAILABLE" };
        }

        // 경기 날짜 기준 규정 판본 조회
        const [ruleVersion] = await transaction
          .select({ id: competitionRuleVersions.id })
          .from(competitionRuleVersions)
          .where(
            and(
              eq(competitionRuleVersions.competition, match.competition),
              eq(competitionRuleVersions.season, match.season),
              lte(competitionRuleVersions.effectiveFrom, match.matchDate),
              or(
                isNull(competitionRuleVersions.effectiveTo),
                gte(competitionRuleVersions.effectiveTo, match.matchDate),
              ),
            ),
          )
          .orderBy(desc(competitionRuleVersions.effectiveFrom))
          .limit(1);

        // 규정 판본 존재 확인
        if (!ruleVersion) {
          return { kind: "RULE_VERSION_UNAVAILABLE" };
        }

        // 분석 행 저장
        const analysisRows = await transaction.execute(sql`
          insert into analyses (
            anonymous_session_id, match_id, video_asset_id, status, retention_class,
            source_url, source_platform, source_fingerprint, applied_rule_version_id,
            pipeline_version, media_policy_version, state_version, created_at, expires_at
          ) values (
            ${command.anonymousSessionId}, ${command.matchId}, ${video.id}, 'QUEUED', 'TEMPORARY',
            ${command.sourceUrl}, ${command.sourcePlatform}, ${Buffer.from(video.content_sha256)}, ${ruleVersion.id},
            ${command.pipelineVersion}, ${command.mediaPolicyVersion}, 0, ${command.createdAt}, ${command.expiresAt}
          )
          returning id
        `);
        // 분석 행 선택
        const [analysis] = analysisRows as unknown as Array<{ id: string }>;

        // 분석 식별자 확인
        if (!analysis) {
          throw new Error("Analysis insert did not return an id");
        }

        // 분석 작업 저장
        await transaction.execute(sql`
          insert into processing_jobs (
            analysis_id, job_type, status, payload_version, job_revision, attempt,
            max_attempts, next_attempt_at, created_at, updated_at
          ) values (
            ${analysis.id}, 'ANALYZE_VIDEO', 'QUEUED', ${command.jobPayloadVersion}, 0, 0,
            ${command.maxJobAttempts}, ${command.createdAt}, ${command.createdAt}, ${command.createdAt}
          )
        `);

        // 멱등 기록 저장
        await transaction.execute(sql`
          insert into idempotency_records (
            anonymous_session_id, operation, key_hash, request_hash, analysis_id, created_at, expires_at
          ) values (
            ${command.anonymousSessionId}, 'CREATE_ANALYSIS', ${keyHash}, ${requestHash},
            ${analysis.id}, ${command.createdAt}, ${command.expiresAt}
          )
        `);

        // 생성 결과 반환
        return { kind: "CREATED", analysisId: analysis.id };
      });
    } catch (error) {
      // 영상 중복 제약 확인
      if (duplicateVideo(error)) {
        return { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" };
      }

      // 처리하지 않은 오류 전달
      throw error;
    }
  }
}

// 분석 저장소 생성
export const analysisRepo = (
  client: DatabaseHandle,
): AnalysisRepo => new AnalysisRepo(client);
