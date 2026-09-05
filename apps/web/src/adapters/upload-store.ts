import { sql } from "drizzle-orm";
import type {
  CompletionCommand,
  UploadCompletionStore as CompletionPort,
  UploadCompletionResult,
  UploadCommand,
  UploadIntentStore as IntentPort,
  UploadIntentResult,
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
  competition: string;
  season: string;
  expires_at: string;
}>;

type LockedIntentRow = Readonly<IntentRow & {
  status: string;
  rights_confirmed_at: string;
  media_policy_version: string;
}>;

const activeStatuses = sql`('CREATED', 'UPLOADING')`;

// 업로드 의도 변환
const intentRecord = (row: IntentRow): UploadIntentRecord => ({
  uploadIntentId: row.id,
  anonymousSessionId: row.anonymous_session_id,
  objectKey: row.object_key,
  expectedSizeBytes: Number(row.expected_size_bytes),
  declaredContentType: row.declared_content_type,
  competition: row.competition,
  season: row.season,
  expiresAt: new Date(row.expires_at).toISOString(),
});

// 업로드 저장소 어댑터
export class UploadStore implements IntentPort, CompletionPort {
  public constructor(private readonly client: DatabaseHandle) {}

  public async intent(command: UploadCommand): Promise<UploadIntentResult> {
    // 업로드 의도 트랜잭션 시작
    return this.client.db.transaction(async (transaction) => {
      // 세션 소유권 조회
      const sessionRows = await transaction.execute(sql`
        select id
        from anonymous_sessions
        where id = ${command.anonymousSessionId}
          and revoked_at is null
          and expires_at > ${command.rightsConfirmedAt}
        for update
      `);
      // 세션 행 선택
      const [session] = sessionRows as unknown as SessionRow[];

      // 세션 유효성 확인
      if (!session) {
        return { kind: "SESSION_UNAVAILABLE" };
      }

      // 업로드 의도 저장
      const rows = await transaction.execute(sql`
        insert into upload_intents (
          anonymous_session_id, object_key, expected_size_bytes,
          declared_content_type, rights_confirmed_at, status,
          expires_at, media_policy_version, competition, season
        ) values (
          ${command.anonymousSessionId}, ${command.objectKey}, ${command.expectedSizeBytes},
          ${command.declaredContentType}, ${command.rightsConfirmedAt}, 'CREATED',
          ${command.expiresAt}, ${command.mediaPolicyVersion},
          ${command.competition ?? "K리그1"}, ${command.season ?? "2026"}
        )
        returning id
      `);
      // 의도 행 선택
      const [row] = rows as unknown as Array<{ id: string }>;

      // 의도 식별자 확인
      if (!row) {
        throw new Error("Upload intent insert did not return an id");
      }

      // 의도 생성 결과 반환
      return { kind: "CREATED", uploadIntentId: row.id };
    });
  }

  public async owned(input: Readonly<{ anonymousSessionId: string; uploadIntentId: string }>): Promise<UploadIntentRecord | null> {
    // 소유 의도 조회
    const rows = await this.client.db.execute(sql`
      select id, anonymous_session_id, object_key, expected_size_bytes,
             declared_content_type, competition, season, expires_at
      from upload_intents
      where id = ${input.uploadIntentId}
        and anonymous_session_id = ${input.anonymousSessionId}
        and status in ${activeStatuses}
    `);
    // 의도 행 선택
    const [row] = rows as unknown as IntentRow[];
    // 의도 결과 변환
    return row ? intentRecord(row) : null;
  }

  public async complete(command: CompletionCommand): Promise<UploadCompletionResult> {
    // 업로드 완료 트랜잭션 시작
    return this.client.db.transaction(async (transaction) => {
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
      const [session] = sessionRows as unknown as SessionRow[];
      // 세션 유효성 확인
      if (!session) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }

      // 업로드 의도 잠금 조회
      const rows = await transaction.execute(sql`
        select id, anonymous_session_id, object_key, expected_size_bytes,
               declared_content_type, competition, season, expires_at, status, rights_confirmed_at,
               media_policy_version
        from upload_intents
        where id = ${command.uploadIntentId}
        for update
      `);
      // 의도 행 선택
      const [intent] = rows as unknown as LockedIntentRow[];

      // 의도 존재 확인
      if (!intent) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }
      // 완료 상태 확인
      if (intent.status === "COMPLETED") {
        return { kind: "UPLOAD_ALREADY_COMPLETED" };
      }
      // 처리 가능 상태 확인
      if (
        intent.status !== "CREATED" &&
        intent.status !== "UPLOADING"
      ) {
        return { kind: "UPLOAD_NOT_READY" };
      }
      // 소유권과 객체 키 확인
      if (
        intent.anonymous_session_id !== command.anonymousSessionId ||
        intent.object_key !== command.objectKey
      ) {
        return { kind: "UPLOAD_NOT_FOUND" };
      }
      // 의도 만료 확인
      if (new Date(intent.expires_at).getTime() <= new Date(command.createdAt).getTime()) {
        return { kind: "UPLOAD_NOT_READY" };
      }
      // 정책 버전 확인
      if (intent.media_policy_version !== command.mediaPolicyVersion) {
        return { kind: "UPLOAD_INVALID" };
      }
      // 객체 크기 확인
      if (Number(intent.expected_size_bytes) !== command.sizeBytes) {
        return { kind: "UPLOAD_INVALID" };
      }

      // 영상 자산 저장
      const assetRows = await transaction.execute(sql`
        insert into video_assets (
          anonymous_session_id, object_key, content_sha256, content_type,
          size_bytes, status, rights_confirmed_at, created_at, expires_at,
          competition, season
        ) values (
          ${command.anonymousSessionId}, ${command.objectKey}, ${Buffer.from(command.contentSha256)}, ${command.contentType},
          ${command.sizeBytes}, 'VALIDATING', ${intent.rights_confirmed_at}, ${command.createdAt}, ${command.expiresAt},
          ${intent.competition}, ${intent.season}
        )
        returning id
      `);
      // 자산 행 선택
      const [asset] = assetRows as unknown as Array<{ id: string }>;

      // 자산 식별자 확인
      if (!asset) {
        throw new Error("Video asset insert did not return an id");
      }

      // 검증 작업 저장
      await transaction.execute(sql`
        insert into processing_jobs (
          video_asset_id, job_type, status, payload_version, job_revision,
          attempt, max_attempts, next_attempt_at, created_at, updated_at
        ) values (
          ${asset.id}, 'VALIDATE_VIDEO', 'QUEUED', ${command.validationJobPayloadVersion}, 0,
          0, ${command.validationMaxAttempts}, ${command.createdAt}, ${command.createdAt}, ${command.createdAt}
        )
      `);

      // 업로드 의도 완료 처리
      await transaction.execute(sql`
        update upload_intents
        set status = 'COMPLETED', completed_at = ${command.createdAt}
        where id = ${command.uploadIntentId}
      `);

      // 완료 결과 반환
      return { kind: "COMPLETED", videoAssetId: asset.id };
    });
  }
}

// 업로드 저장소 생성
export const uploadStore = (client: DatabaseHandle): UploadStore =>
  new UploadStore(client);
