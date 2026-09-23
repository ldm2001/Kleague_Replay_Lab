// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    CompletionCommand,
    UploadCompletionStore as CompletionPort,
    UploadCompletionResult,
    UploadCommand,
    UploadIntentStore as IntentPort,
    UploadIntentResult,
    UploadIntentRecord
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;

// 익명 세션 조회 행 정의
type SessionRow = Readonly<{ id: string }>;

// 업로드 허가 조회 행 정의
type IntentRow = Readonly<{
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymous_session_id: string;
    // 객체 저장소에서 파일을 찾는 경로
    object_key: string;
    // 업로드 전에 신고한 파일 바이트 크기
    expected_size_bytes: number | string;
    // 업로드 전에 신고한 콘텐츠 형식
    declared_content_type: string;
    // 규정 적용 대상 대회
    competition: string;
    // 규정 적용 대상 시즌
    season: string;
    // 접근과 보존을 허용하는 만료 시각
    expires_at: string;
}>;

// 잠금으로 보호한 업로드 허가와 정책 조회 행 정의
type LockedIntentRow = Readonly<IntentRow & {
    // 처리 상태 또는 요청 응답 상태
    status: string;
    // 영상 사용 권리를 확인한 시각
    rights_confirmed_at: string;
    // 파일 보존과 허용 형식 정책의 버전
    media_policy_version: string;
}>;

// 업로드 완료를 허용할 진행 중 상태 목록 지정
const activeStatuses = sql`('CREATED', 'UPLOADING')`;

// 업로드 의도 변환
const intentRecord = (row: IntentRow): UploadIntentRecord => ({
    // 업로드 허가 기록의 식별자
    uploadIntentId: row.id,
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: row.anonymous_session_id,
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: row.object_key,
    // 업로드 전에 신고한 파일 바이트 크기
    expectedSizeBytes: Number(row.expected_size_bytes),
    // 업로드 전에 신고한 콘텐츠 형식
    declaredContentType: row.declared_content_type,
    // 규정 적용 대상 대회
    competition: row.competition,
    // 규정 적용 대상 시즌
    season: row.season,
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: new Date(row.expires_at).toISOString(),
});

// 업로드 저장소 어댑터
export class UploadStore implements IntentPort, CompletionPort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 업로드 의도와 원본 정보 등록
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
                // 사용할 수 없는 익명 세션 결과 반환
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
          ${command.competition ?? "UNKNOWN"}, ${command.season ?? "UNKNOWN"}
        )
        returning id
      `);
            // 의도 행 선택
            const [row] = rows as unknown as Array<{ id: string }>;

            // 의도 식별자 확인
            if (!row) {
                // 업로드 허가 식별자가 없는 저장 실패 전달
                throw new Error("Upload intent insert did not return an id");
            }

            // 의도 생성 결과 반환
            return { kind: "CREATED", uploadIntentId: row.id };
        });
    }

    // 세션의 업로드 소유권 확인
    public async owned(
        input: Readonly<{ anonymousSessionId: string; uploadIntentId: string }>
    ): Promise<UploadIntentRecord | null> {
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

    // 업로드 완료 상태 기록
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
                // 세션 소유의 업로드 기록이 없는 결과 반환
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
                // 현재 조건에서 사용할 업로드 기록이 없는 결과 반환
                return { kind: "UPLOAD_NOT_FOUND" };
            }
            // 완료 상태 확인
            if (intent.status === "COMPLETED") {
                // 이미 완료된 업로드의 재완료 거부 반환
                return { kind: "UPLOAD_ALREADY_COMPLETED" };
            }
            // 처리 가능 상태 확인
            if (intent.status !== "CREATED" && intent.status !== "UPLOADING") {
                // 파일 전송 준비가 되지 않은 업로드 결과 반환
                return { kind: "UPLOAD_NOT_READY" };
            }
            // 소유권과 객체 키 확인
            if (
                intent.anonymous_session_id !== command.anonymousSessionId ||
                intent.object_key !== command.objectKey
            ) {
                // 완료 처리 대상 업로드 부재 반환
                return { kind: "UPLOAD_NOT_FOUND" };
            }
            // 의도 만료 확인
            if (new Date(intent.expires_at).getTime() <= new Date(command.createdAt).getTime()) {
                // 아직 완료할 수 없는 업로드 상태 반환
                return { kind: "UPLOAD_NOT_READY" };
            }
            // 정책 버전 확인
            if (intent.media_policy_version !== command.mediaPolicyVersion) {
                // 신고 조건과 맞지 않는 업로드 거부 반환
                return { kind: "UPLOAD_INVALID" };
            }
            // 객체 크기 확인
            if (Number(intent.expected_size_bytes) !== command.sizeBytes) {
                // 유효성 검사에 실패한 업로드 결과 반환
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
                // 영상 자산 식별자가 없는 저장 실패 전달
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
