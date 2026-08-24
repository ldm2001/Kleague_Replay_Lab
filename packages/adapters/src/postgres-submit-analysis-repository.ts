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

const isDuplicateVideoError = (error: unknown): boolean => {
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

  return candidate.cause !== undefined && isDuplicateVideoError(candidate.cause);
};

export class PostgresSubmitAnalysisRepository implements SubmitAnalysisRepository {
  public constructor(private readonly client: DatabaseHandle) {}

  public async submit(command: SubmitAnalysisCommand): Promise<SubmitAnalysisRepositoryResult> {
    const keyHash = Buffer.from(command.keyHash);
    const requestHash = Buffer.from(command.requestHash);
    const lockScope = `${command.anonymousSessionId}:${keyHash.toString("hex")}`;

    try {
      return await this.client.db.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))`,
        );

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

        if (existingIdempotency) {
          return Buffer.compare(existingIdempotency.requestHash, requestHash) === 0
            ? { kind: "REPLAYED", analysisId: existingIdempotency.analysisId }
            : { kind: "IDEMPOTENCY_KEY_REUSED" };
        }

        const sessionRows = await transaction.execute(sql`
          select id
          from anonymous_sessions
          where id = ${command.anonymousSessionId}
            and revoked_at is null
            and expires_at > ${command.createdAt}
          for update
        `);
        const [session] = sessionRows as unknown as LockedSessionRow[];

        if (!session) {
          return { kind: "VIDEO_ASSET_UNAVAILABLE" };
        }

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
        const [video] = videoRows as unknown as LockedVideoRow[];

        if (!video || video.anonymous_session_id !== command.anonymousSessionId) {
          return { kind: "VIDEO_ASSET_UNAVAILABLE" };
        }

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

        if (!match) {
          return { kind: "MATCH_UNAVAILABLE" };
        }

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

        if (!ruleVersion) {
          return { kind: "RULE_VERSION_UNAVAILABLE" };
        }

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
        const [analysis] = analysisRows as unknown as Array<{ id: string }>;

        if (!analysis) {
          throw new Error("Analysis insert did not return an id");
        }

        await transaction.execute(sql`
          insert into processing_jobs (
            analysis_id, job_type, status, payload_version, job_revision, attempt,
            max_attempts, next_attempt_at, created_at, updated_at
          ) values (
            ${analysis.id}, 'ANALYZE_VIDEO', 'QUEUED', ${command.jobPayloadVersion}, 0, 0,
            ${command.maxJobAttempts}, ${command.createdAt}, ${command.createdAt}, ${command.createdAt}
          )
        `);

        await transaction.execute(sql`
          insert into idempotency_records (
            anonymous_session_id, operation, key_hash, request_hash, analysis_id, created_at, expires_at
          ) values (
            ${command.anonymousSessionId}, 'CREATE_ANALYSIS', ${keyHash}, ${requestHash},
            ${analysis.id}, ${command.createdAt}, ${command.expiresAt}
          )
        `);

        return { kind: "CREATED", analysisId: analysis.id };
      });
    } catch (error) {
      if (isDuplicateVideoError(error)) {
        return { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" };
      }

      throw error;
    }
  }
}

export const submitRepo = (
  client: DatabaseHandle,
): PostgresSubmitAnalysisRepository => new PostgresSubmitAnalysisRepository(client);

export const createPostgresSubmitAnalysisRepository = submitRepo;
export const createSubmitAnalysisRepository = submitRepo;
