import { sql } from "drizzle-orm";
import type {
  CompleteUploadCommand,
  CompleteUploadRepository,
  CompleteUploadRepositoryResult,
  CreateUploadCommand,
  CreateUploadRepository,
  CreateUploadRepositoryResult,
  UploadIntentRecord,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type SessionRow = Readonly<{ id: string }>;

type IntentRow = Readonly<{
  id: string;
  anonymous_session_id: string;
  object_key: string;
  expected_size_bytes: number | string;
  declared_content_type: string;
  expires_at: string;
}>;

type LockedIntentRow = Readonly<IntentRow & {
  status: string;
  rights_confirmed_at: string;
  media_policy_version: string;
}>;

const activeStatuses = sql`('CREATED', 'UPLOADING')`;

const intentRecord = (row: IntentRow): UploadIntentRecord => ({
  uploadIntentId: row.id,
  anonymousSessionId: row.anonymous_session_id,
  objectKey: row.object_key,
  expectedSizeBytes: Number(row.expected_size_bytes),
  declaredContentType: row.declared_content_type,
  expiresAt: new Date(row.expires_at).toISOString(),
});

export class UploadRepo implements CreateUploadRepository, CompleteUploadRepository {
  public constructor(private readonly client: DatabaseHandle) {}

  public async intent(command: CreateUploadCommand): Promise<CreateUploadRepositoryResult> {
    return this.client.db.transaction(async (transaction) => {
      const sessionRows = await transaction.execute(sql`
        select id
        from anonymous_sessions
        where id = ${command.anonymousSessionId}
          and revoked_at is null
          and expires_at > ${command.rightsConfirmedAt}
        for update
      `);
      const [session] = sessionRows as unknown as SessionRow[];

      if (!session) {
        return { kind: "SESSION_UNAVAILABLE" };
      }

      const rows = await transaction.execute(sql`
        insert into upload_intents (
          anonymous_session_id, object_key, expected_size_bytes,
          declared_content_type, rights_confirmed_at, status,
          expires_at, media_policy_version
        ) values (
          ${command.anonymousSessionId}, ${command.objectKey}, ${command.expectedSizeBytes},
          ${command.declaredContentType}, ${command.rightsConfirmedAt}, 'CREATED',
          ${command.expiresAt}, ${command.mediaPolicyVersion}
        )
        returning id
      `);
      const [row] = rows as unknown as Array<{ id: string }>;

      if (!row) {
        throw new Error("Upload intent insert did not return an id");
      }

      return { kind: "CREATED", uploadIntentId: row.id };
    });
  }

  public async owned(input: Readonly<{ anonymousSessionId: string; uploadIntentId: string }>): Promise<UploadIntentRecord | null> {
    const rows = await this.client.db.execute(sql`
      select id, anonymous_session_id, object_key, expected_size_bytes,
             declared_content_type, expires_at
      from upload_intents
      where id = ${input.uploadIntentId}
        and anonymous_session_id = ${input.anonymousSessionId}
        and status in ${activeStatuses}
    `);
    const [row] = rows as unknown as IntentRow[];
    return row ? intentRecord(row) : null;
  }

  public async complete(command: CompleteUploadCommand): Promise<CompleteUploadRepositoryResult> {
    return this.client.db.transaction(async (transaction) => {
      const sessionRows = await transaction.execute(sql`
        select id
        from anonymous_sessions
        where id = ${command.anonymousSessionId}
          and revoked_at is null
          and expires_at > ${command.createdAt}
        for update
      `);
      const [session] = sessionRows as unknown as SessionRow[];
      if (!session) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }

      const rows = await transaction.execute(sql`
        select id, anonymous_session_id, object_key, expected_size_bytes,
               declared_content_type, expires_at, status, rights_confirmed_at,
               media_policy_version
        from upload_intents
        where id = ${command.uploadIntentId}
        for update
      `);
      const [intent] = rows as unknown as LockedIntentRow[];

      if (!intent) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }
      if (intent.status === "COMPLETED") {
        return { kind: "UPLOAD_ALREADY_COMPLETED" };
      }
      if (
        intent.status !== "CREATED" &&
        intent.status !== "UPLOADING"
      ) {
        return { kind: "UPLOAD_NOT_READY" };
      }
      if (
        intent.anonymous_session_id !== command.anonymousSessionId ||
        intent.object_key !== command.objectKey
      ) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }
      if (new Date(intent.expires_at).getTime() <= new Date(command.createdAt).getTime()) {
        return { kind: "UPLOAD_NOT_READY" };
      }
      if (intent.media_policy_version !== command.mediaPolicyVersion) {
        return { kind: "UPLOAD_INVALID" };
      }
      if (Number(intent.expected_size_bytes) !== command.sizeBytes) {
        return { kind: "UPLOAD_INVALID" };
      }

      const assetRows = await transaction.execute(sql`
        insert into video_assets (
          anonymous_session_id, object_key, content_sha256, content_type,
          size_bytes, status, rights_confirmed_at, created_at, expires_at
        ) values (
          ${command.anonymousSessionId}, ${command.objectKey}, ${Buffer.from(command.contentSha256)}, ${command.contentType},
          ${command.sizeBytes}, 'VALIDATING', ${intent.rights_confirmed_at}, ${command.createdAt}, ${command.expiresAt}
        )
        returning id
      `);
      const [asset] = assetRows as unknown as Array<{ id: string }>;

      if (!asset) {
        throw new Error("Video asset insert did not return an id");
      }

      await transaction.execute(sql`
        insert into processing_jobs (
          video_asset_id, job_type, status, payload_version, job_revision,
          attempt, max_attempts, next_attempt_at, created_at, updated_at
        ) values (
          ${asset.id}, 'VALIDATE_VIDEO', 'QUEUED', ${command.validationJobPayloadVersion}, 0,
          0, ${command.validationMaxAttempts}, ${command.createdAt}, ${command.createdAt}, ${command.createdAt}
        )
      `);

      await transaction.execute(sql`
        update upload_intents
        set status = 'COMPLETED', completed_at = ${command.createdAt}
        where id = ${command.uploadIntentId}
      `);

      return { kind: "COMPLETED", videoAssetId: asset.id };
    });
  }
}

export const uploadRepo = (client: DatabaseHandle): UploadRepo =>
  new UploadRepo(client);
