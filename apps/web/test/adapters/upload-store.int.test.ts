// 업로드 저장소 통합 테스트
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CompletionCommand, UploadCommand } from "@replay/application";
import { client } from "@replay/database";
import { uploadStore } from "@replay/adapters";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;

// 생성결과 시점 시험용 2030 01 00 00 준비
const createdAt = "2030-01-01T12:00:00.000Z";
// 업로드 만료시각 시점 시험용 2030 01 00 00 준비
const uploadExpiresAt = "2030-01-01T13:00:00.000Z";
// 원본 만료시각 시점 시험용 2030 01 00 00 준비
const sourceExpiresAt = "2030-01-01T14:00:00.000Z";

// 데이터베이스 결과 처리 수행
describeDatabase("PostgreSQL upload repository", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = databaseUrl ? client(databaseUrl) : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;

    // 저장소 시험용 업로드 저장소 결과 준비
    const repository = uploadStore(database);
    // 세션목록 시험용 0개 항목 목록 준비
    const sessions: string[] = [];
    // 시험자료 시험용 0개 항목 목록 준비
    const intents: string[] = [];

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await database.sql`select 1`;
    });

    afterEach(async () => {
        // 시험자료 구간치환 결과의 각 사례 순회
        for (const intentId of intents.splice(0)) {
            // 영상 처리 작업 삭제
            await database.sql`delete from processing_jobs where video_asset_id in (select id from video_assets where object_key in (select object_key from upload_intents where id = ${intentId}))`;
            // 영상 자산 삭제
            await database.sql`delete from video_assets where object_key in (select object_key from upload_intents where id = ${intentId})`;
            // 업로드 예약 삭제
            await database.sql`delete from upload_intents where id = ${intentId}`;
        }
        // 세션목록 구간치환 결과의 각 사례 순회
        for (const sessionId of sessions.splice(0)) {
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
        }
    });

    afterAll(async () => {
        // 데이터베이스 연결종료 결과 처리 수행
        await database.close();
    });

    // 검증용 사전 세션 구성
    const seedSession = async (
        overrides: { expiresAt?: string; revokedAt?: string | null } = {}
    ) => {
        // 세션 식별자 시험용 무작위식별자 결과 준비
        const sessionId = randomUUID();
        // 세션목록 추가 결과 처리 수행
        sessions.push(sessionId);
        // 익명 세션 삽입
        await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at, revoked_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', ${overrides.expiresAt ?? uploadExpiresAt}, ${overrides.revokedAt ?? null})
    `;
        // 세션 식별자 반환
        return sessionId;
    };

    // 검증용 요청 구성
    const request = (sessionId: string, overrides: Partial<UploadCommand> = {}): UploadCommand => ({
        anonymousSessionId: sessionId,
        objectKey: `temporary/${randomUUID()}.mp4`,
        expectedSizeBytes: 100,
        declaredContentType: "video/mp4",
        rightsConfirmedAt: createdAt,
        expiresAt: uploadExpiresAt,
        mediaPolicyVersion: "media-v1",
        ...overrides
    });

    // 검증용 완료 구성
    const completion = (
        sessionId: string,
        intentId: string,
        objectKey: string,
        overrides: Partial<CompletionCommand> = {}
    ): CompletionCommand => ({
        uploadIntentId: intentId,
        anonymousSessionId: sessionId,
        objectKey,
        sizeBytes: 100,
        contentSha256: Uint8Array.from([1, 2, 3]),
        contentType: "application/octet-stream",
        createdAt,
        expiresAt: sourceExpiresAt,
        mediaPolicyVersion: "media-v1",
        validationJobPayloadVersion: 1,
        validationMaxAttempts: 3,
        ...overrides
    });

    it("persists an intent only for an active session", async () => {
        // 기초자료 세션 결과를 세션 식별자에 저장
        const sessionId = await seedSession();
        // 명령 시험용 요청 결과 준비
        const command = request(sessionId);

        // 저장소 의도 결과를 결과에 저장
        const result = await repository.intent(command);

        // 결과 종류의 기대값 생성완료 일치 확인
        expect(result.kind).toBe("CREATED");
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "CREATED") return;
        // 시험자료 추가 결과 처리 수행
        intents.push(result.uploadIntentId);

        // 업로드 예약 조회
        const [row] = await database.sql<
            {
                anonymous_session_id: string;
                object_key: string;
                expected_size_bytes: string;
                declared_content_type: string;
                rights_confirmed_at: string;
                status: string;
                media_policy_version: string;
            }[]
        >`select * from upload_intents where id = ${result.uploadIntentId}`;
        // 행의 익명 세션 식별자 및 객체 키 및 기대값 크기 바이트 100 및 신고 내용 유형 영상 자료의 필드 일치 확인
        expect(row).toMatchObject({
            anonymous_session_id: sessionId,
            object_key: command.objectKey,
            expected_size_bytes: "100",
            declared_content_type: "video/mp4",
            status: "CREATED",
            media_policy_version: "media-v1"
        });
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(row!.rights_confirmed_at).toISOString()).toBe(createdAt);
    });

    it("rejects expired or revoked sessions without writing an intent", async () => {
        // 2개 항목 목록의 각 사례 순회
        for (const overrides of [
            { expiresAt: "2030-01-01T11:59:59.000Z" },
            { revokedAt: "2030-01-01T11:00:00.000Z" }
        ]) {
            // 기초자료 세션 결과를 세션 식별자에 저장
            const sessionId = await seedSession(overrides);
            // 세션 사용 불가 내용을 포함한 기대 결과 일치 확인
            await expect(repository.intent(request(sessionId))).resolves.toEqual({
                kind: "SESSION_UNAVAILABLE"
            });
        }
    });

    it("completes an owned intent and queues validation atomically", async () => {
        // 기초자료 세션 결과를 세션 식별자에 저장
        const sessionId = await seedSession();
        // 저장소 의도 결과를 생성결과에 저장
        const created = await repository.intent(request(sessionId));
        // 생성결과 종류의 기대값 생성완료 일치 확인
        expect(created.kind).toBe("CREATED");
        // 생성결과 종류 비교 조건에 따른 처리 경로 분기
        if (created.kind !== "CREATED") return;
        // 시험자료 추가 결과 처리 수행
        intents.push(created.uploadIntentId);
        // 업로드 예약 조회
        const [intent] = await database.sql<
            { object_key: string }[]
        >`select object_key from upload_intents where id = ${created.uploadIntentId}`;

        // 저장소 완료 결과를 결과에 저장
        const result = await repository.complete(
            completion(sessionId, created.uploadIntentId, intent!.object_key)
        );

        // 결과 종류의 기대값 완료 일치 확인
        expect(result.kind).toBe("COMPLETED");
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "COMPLETED") return;
        // 영상 자산 조회
        const [asset] = await database.sql<
            {
                id: string;
                anonymous_session_id: string;
                object_key: string;
                content_sha256: Buffer;
                content_type: string;
                size_bytes: string;
                status: string;
                rights_confirmed_at: string;
                expires_at: string;
            }[]
        >`select * from video_assets where id = ${result.videoAssetId}`;
        // 영상 처리 작업 조회
        const [job] = await database.sql<
            {
                job_type: string;
                status: string;
                payload_version: number;
                max_attempts: number;
            }[]
        >`select job_type, status, payload_version, max_attempts from processing_jobs where video_asset_id = ${result.videoAssetId}`;
        // 업로드 예약 조회
        const [updatedIntent] = await database.sql<
            { status: string; completed_at: string }[]
        >`select status, completed_at from upload_intents where id = ${created.uploadIntentId}`;

        // 자산의 식별자 및 익명 세션 식별자 및 객체 키 및 내용 유형 지정 문자열 자료의 필드 일치 확인
        expect(asset).toMatchObject({
            id: result.videoAssetId,
            anonymous_session_id: sessionId,
            object_key: intent!.object_key,
            content_type: "application/octet-stream",
            size_bytes: "100",
            status: "VALIDATING"
        });
        // 자산 내용 해시의 바이트버퍼 변환 결과 기준 구조 일치 확인
        expect(asset?.content_sha256).toEqual(Buffer.from([1, 2, 3]));
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(asset!.rights_confirmed_at).toISOString()).toBe(createdAt);
        // 날짜 표준시각문자열 결과의 기대값 원본 만료시각 시점 일치 확인
        expect(new Date(asset!.expires_at).toISOString()).toBe(sourceExpiresAt);
        // 작업의 작업 유형 영상 및 상태 대기중 및 전송자료 버전 1 및 지정 항목 3 자료 기준 구조 일치 확인
        expect(job).toEqual({
            job_type: "VALIDATE_VIDEO",
            status: "QUEUED",
            payload_version: 1,
            max_attempts: 3
        });
        // 의도 상태의 기대값 완료 일치 확인
        expect(updatedIntent?.status).toBe("COMPLETED");
        // 날짜 표준시각문자열 결과의 기대값 생성결과 시점 일치 확인
        expect(new Date(updatedIntent!.completed_at).toISOString()).toBe(createdAt);
    });

    it("returns the active owned intent and hides another session's intent", async () => {
        // 기초자료 세션 결과를 시험자료에 저장
        const owner = await seedSession();
        // 기초자료 세션 결과를 시험자료에 저장
        const other = await seedSession();
        // 저장소 의도 결과를 생성결과에 저장
        const created = await repository.intent(request(owner));
        // 생성결과 종류의 기대값 생성완료 일치 확인
        expect(created.kind).toBe("CREATED");
        // 생성결과 종류 비교 조건에 따른 처리 경로 분기
        if (created.kind !== "CREATED") return;
        // 시험자료 추가 결과 처리 수행
        intents.push(created.uploadIntentId);

        // 업로드 예약 조회
        const [row] = await database.sql<
            { object_key: string }[]
        >`select object_key from upload_intents where id = ${created.uploadIntentId}`;
        // 저장소 결과의 업로드 의도 식별자 및 익명 세션 식별자 및 객체 키 및 예상바이트크기 100 자료의 필드 일치 확인
        await expect(
            repository.owned({ anonymousSessionId: owner, uploadIntentId: created.uploadIntentId })
        ).resolves.toMatchObject({
            uploadIntentId: created.uploadIntentId,
            anonymousSessionId: owner,
            objectKey: row!.object_key,
            expectedSizeBytes: 100
        });
        // 저장소 결과의 빈 값 확인
        await expect(
            repository.owned({ anonymousSessionId: other, uploadIntentId: created.uploadIntentId })
        ).resolves.toBeNull();
    });

    it("rejects a completion command with a stale policy or size", async () => {
        // 기초자료 세션 결과를 세션 식별자에 저장
        const sessionId = await seedSession();
        // 저장소 의도 결과를 생성결과에 저장
        const created = await repository.intent(request(sessionId));
        // 생성결과 종류의 기대값 생성완료 일치 확인
        expect(created.kind).toBe("CREATED");
        // 생성결과 종류 비교 조건에 따른 처리 경로 분기
        if (created.kind !== "CREATED") return;
        // 시험자료 추가 결과 처리 수행
        intents.push(created.uploadIntentId);
        // 업로드 예약 조회
        const [intent] = await database.sql<
            { object_key: string }[]
        >`select object_key from upload_intents where id = ${created.uploadIntentId}`;

        // 유효하지 않은 업로드 내용을 포함한 기대 결과 일치 확인
        await expect(
            repository.complete(
                completion(sessionId, created.uploadIntentId, intent!.object_key, {
                    mediaPolicyVersion: "media-v2"
                })
            )
        ).resolves.toEqual({ kind: "UPLOAD_INVALID" });
        // 유효하지 않은 업로드 내용을 포함한 기대 결과 일치 확인
        await expect(
            repository.complete(
                completion(sessionId, created.uploadIntentId, intent!.object_key, { sizeBytes: 99 })
            )
        ).resolves.toEqual({ kind: "UPLOAD_INVALID" });
    });

    it("rolls back the asset and intent state when validation job creation fails", async () => {
        // 기초자료 세션 결과를 세션 식별자에 저장
        const sessionId = await seedSession();
        // 저장소 의도 결과를 생성결과에 저장
        const created = await repository.intent(request(sessionId));
        // 생성결과 종류의 기대값 생성완료 일치 확인
        expect(created.kind).toBe("CREATED");
        // 생성결과 종류 비교 조건에 따른 처리 경로 분기
        if (created.kind !== "CREATED") return;
        // 시험자료 추가 결과 처리 수행
        intents.push(created.uploadIntentId);
        // 업로드 예약 조회
        const [intent] = await database.sql<
            { object_key: string }[]
        >`select object_key from upload_intents where id = ${created.uploadIntentId}`;

        // 저장소 완료 결과의 잘못된 입력의 예외 발생 확인
        await expect(
            repository.complete(
                completion(sessionId, created.uploadIntentId, intent!.object_key, {
                    validationMaxAttempts: 0
                })
            )
        ).rejects.toThrow();
        // 업로드 예약 조회
        const [intentAfter] = await database.sql<
            { status: string }[]
        >`select status from upload_intents where id = ${created.uploadIntentId}`;
        // 영상 자산 조회
        const [assetCount] = await database.sql<
            { count: string }[]
        >`select count(*)::text as count from video_assets where object_key = ${intent!.object_key}`;
        // 의도 상태의 기대값 생성완료 일치 확인
        expect(intentAfter?.status).toBe("CREATED");
        // 자산 개수 개수의 기대값 0 일치 확인
        expect(assetCount?.count).toBe("0");
    });
});
