import { describe, expect, it } from "vitest";
import {
    completion,
    upload,
    type Clock,
    type UploadCompletionStore,
    type CompletionStorage,
    type UploadIntentStore,
    type UploadStorage,
    type UploadPolicy
} from "@replay/application";

// 세션 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// 의도 식별자 시험용 22222222 2222 4222 8222 222222222222 준비
const INTENT_ID = "22222222-2222-4222-8222-222222222222";
// 영상 식별자 시험용 33333333 3333 4333 8333 333333333333 준비
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-08-24T00:00:00.000Z");

// 정책 시험 입력으로 바이트 및 내용 및 업로드 의도 시각 및 원본 시각 자료 생성
const POLICY: UploadPolicy = {
    maxBytes: 100 * 1024 * 1024,
    allowedContentTypes: ["video/mp4"],
    uploadIntentTtlMs: 15 * 60 * 1000,
    sourceTtlMs: 2 * 60 * 60 * 1000,
    mediaPolicyVersion: "media-v1",
    validationJobPayloadVersion: 1,
    validationMaxAttempts: 3,
};

// 시계 시험 입력으로 현재시각 자료 생성
const clock: Clock = { now: () => NOW };

class StorageDouble implements UploadStorage {
    readonly requests: Array<Parameters<UploadStorage["grant"]>[0]> = [];
    readonly cleaned: string[] = [];

    // 검증용 권한 구성
    async grant(request: Parameters<UploadStorage["grant"]>[0]) {
        // 입력 조건 추가 결과 처리 수행
        this.requests.push(request);
        // 객체 키 세션 영상 및 업로드 주소 저장공간 업로드 토큰 및 만료시각 시점 2026 08 15 00 자료 반환
        return {
            objectKey: "temporary/session/video.mp4",
            uploadUrl: "https://storage.test/upload-token",
            expiresAt: "2026-08-24T00:15:00.000Z",
        };
    }

    // 검증용 정리 구성
    async cleanup(objectKey: string) {
        // 입력 조건 추가 결과 처리 수행
        this.cleaned.push(objectKey);
    }
}

class IntentDouble implements UploadIntentStore {
    readonly commands: Array<Parameters<UploadIntentStore["intent"]>[0]> = [];
    result: Awaited<ReturnType<UploadIntentStore["intent"]>> = {
        kind: "CREATED" as const,
        uploadIntentId: INTENT_ID
    };

    // 검증용 업로드 의도 구성
    async intent(command: Parameters<UploadIntentStore["intent"]>[0]) {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 결과 반환
        return this.result;
    }
}

class ObjectDouble implements CompletionStorage {
    readonly objectKeys: string[] = [];
    headResult: Awaited<ReturnType<CompletionStorage["head"]>> = {
        sizeBytes: 50,
        contentSha256: Uint8Array.from([1, 2, 3]),
    };

    // 검증용 메타데이터 구성
    async head(objectKey: string) {
        // 입력 조건 객체 키목록 추가 결과 처리 수행
        this.objectKeys.push(objectKey);
        // 입력 조건 메타정보 결과 반환
        return this.headResult;
    }
}

class CompletionDouble implements UploadCompletionStore {
    intent: Awaited<ReturnType<UploadCompletionStore["owned"]>> = {
        uploadIntentId: INTENT_ID,
        anonymousSessionId: SESSION_ID,
        objectKey: "temporary/session/video.mp4",
        expectedSizeBytes: 50,
        declaredContentType: "video/mp4",
        competition: "K리그1",
        season: "2026",
        expiresAt: "2026-08-24T00:15:00.000Z",
    };
    readonly commands: Array<Parameters<UploadCompletionStore["complete"]>[0]> = [];

    // 검증용 소유권 구성
    async owned() {
        // 입력 조건 의도 반환
        return this.intent;
    }

    // 검증용 완료 구성
    async complete(command: Parameters<UploadCompletionStore["complete"]>[0]) {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 종류 및 영상 자산 식별자 자료 반환
        return { kind: "COMPLETED" as const, videoAssetId: VIDEO_ID };
    }
}

describe("upload", () => {
    it("creates a short-lived private upload grant and intent command", async () => {
        // 저장공간 시험용 저장공간 준비
        const storage = new StorageDouble();
        // 저장소 시험용 의도 준비
        const repository = new IntentDouble();
        // 작업 시험용 업로드 결과 준비
        const operation = upload({ clock, policy: POLICY, storage, repository });

        // 작업 결과를 결과에 저장
        const result = await operation({
            anonymousSessionId: SESSION_ID,
            expectedSizeBytes: 50,
            declaredContentType: "video/mp4",
            rightsConfirmed: true
        });

        // 결과의 종류 생성완료 및 업로드 의도 식별자 및 객체 키 세션 영상 및 업로드 주소 저장공간 업로드 토큰 자료 기준 구조 일치 확인
        expect(result).toEqual({
            kind: "CREATED",
            uploadIntentId: INTENT_ID,
            objectKey: "temporary/session/video.mp4",
            uploadUrl: "https://storage.test/upload-token",
            expiresAt: "2026-08-24T00:15:00.000Z"
        });
        // 알 수 없음 조건을 포함한 기대 결과 일치 확인
        expect(repository.commands[0]).toMatchObject({
            anonymousSessionId: SESSION_ID,
            objectKey: "temporary/session/video.mp4",
            expectedSizeBytes: 50,
            declaredContentType: "video/mp4",
            rightsConfirmedAt: "2026-08-24T00:00:00.000Z",
            expiresAt: "2026-08-24T00:15:00.000Z",
            mediaPolicyVersion: "media-v1",
            competition: "UNKNOWN",
            season: "UNKNOWN"
        });
        // 저장공간 중 선택 항목 만료시각 시점의 기대값 2026 08 15 00 일치 확인
        expect(storage.requests[0]?.expiresAt).toBe("2026-08-24T00:15:00.000Z");
    });

    it("keeps the selected competition context in the intent command", async () => {
        // 저장공간 시험용 저장공간 준비
        const storage = new StorageDouble();
        // 저장소 시험용 의도 준비
        const repository = new IntentDouble();
        // 작업 시험용 업로드 결과 준비
        const operation = upload({ clock, policy: POLICY, storage, repository });

        // 작업 결과 처리 수행
        await operation({
            anonymousSessionId: SESSION_ID,
            expectedSizeBytes: 50,
            declaredContentType: "video/mp4",
            rightsConfirmed: true,
            competition: "K리그2",
            season: "2026"
        });

        // 저장소 명령목록 중 선택 항목의 대회 지정 문자열 및 시즌 2026 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({ competition: "K리그2", season: "2026" });
    });

    it("cleans up the grant when the session cannot be persisted", async () => {
        // 저장공간 시험용 저장공간 준비
        const storage = new StorageDouble();
        // 저장소 시험용 의도 준비
        const repository = new IntentDouble();
        // 저장소 결과를 종류 세션 자료로 설정
        repository.result = { kind: "SESSION_UNAVAILABLE" };

        // 업로드 결과를 결과에 저장
        const result = await upload({ clock, policy: POLICY, storage, repository })({
            anonymousSessionId: SESSION_ID,
            expectedSizeBytes: 50,
            declaredContentType: "video/mp4",
            rightsConfirmed: true
        });

        // 세션 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "SESSION_UNAVAILABLE" });
        // 저장공간의 1개 항목 목록 기준 구조 일치 확인
        expect(storage.cleaned).toEqual(["temporary/session/video.mp4"]);
    });

    it("rejects invalid size, content type, rights, and session before external ports", async () => {
        // 저장공간 시험용 저장공간 준비
        const storage = new StorageDouble();
        // 저장소 시험용 의도 준비
        const repository = new IntentDouble();
        // 작업 시험용 업로드 결과 준비
        const operation = upload({ clock, policy: POLICY, storage, repository });

        // 입력 오류 및 식별자 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: "bad",
                expectedSizeBytes: 50,
                declaredContentType: "video/mp4",
                rightsConfirmed: true
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_ID" });
        // 입력 오류 및 파일 크기 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: SESSION_ID,
                expectedSizeBytes: 0,
                declaredContentType: "video/mp4",
                rightsConfirmed: true
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_SIZE" });
        // 파일 크기 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: SESSION_ID,
                expectedSizeBytes: POLICY.maxBytes + 1,
                declaredContentType: "video/mp4",
                rightsConfirmed: true
            })
        ).resolves.toEqual({ kind: "INVALID_SIZE" });
        // 지원하지 않는 콘텐츠 형식 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: SESSION_ID,
                expectedSizeBytes: 50,
                declaredContentType: "video/webm",
                rightsConfirmed: true
            })
        ).resolves.toEqual({ kind: "UNSUPPORTED_CONTENT_TYPE" });
        // 영상 이용 권한 미확인 조건을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: SESSION_ID,
                expectedSizeBytes: 50,
                declaredContentType: "video/mp4",
                rightsConfirmed: false
            })
        ).resolves.toEqual({ kind: "RIGHTS_NOT_CONFIRMED" });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                anonymousSessionId: SESSION_ID,
                expectedSizeBytes: 50,
                declaredContentType: "video/mp4",
                rightsConfirmed: true,
                competition: "K리그3",
                season: "2026"
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "COMPETITION" });
        // 저장공간의 항목 수 0 확인
        expect(storage.requests).toHaveLength(0);
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});

describe("completeUpload", () => {
    it("heads the private object and creates a validating video asset command", async () => {
        // 저장공간 시험용 객체 준비
        const storage = new ObjectDouble();
        // 저장소 시험용 완료처리 준비
        const repository = new CompletionDouble();
        // 작업 시험용 완료처리 결과 준비
        const operation = completion({ clock, policy: POLICY, storage, repository });

        // 작업 결과를 결과에 저장
        const result = await operation({
            anonymousSessionId: SESSION_ID,
            uploadIntentId: INTENT_ID
        });

        // 결과의 종류 완료 및 영상 자산 식별자 자료 기준 구조 일치 확인
        expect(result).toEqual({ kind: "COMPLETED", videoAssetId: VIDEO_ID });
        // 저장공간 객체 키목록의 1개 항목 목록 기준 구조 일치 확인
        expect(storage.objectKeys).toEqual(["temporary/session/video.mp4"]);
        // 저장소 명령목록 중 선택 항목의 업로드 의도 식별자 및 익명 세션 식별자 및 크기 바이트 50 및 내용 해시 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({
            uploadIntentId: INTENT_ID,
            anonymousSessionId: SESSION_ID,
            sizeBytes: 50,
            contentSha256: Uint8Array.from([1, 2, 3]),
            contentType: "video/mp4",
            expiresAt: "2026-08-24T02:00:00.000Z",
            mediaPolicyVersion: "media-v1",
            validationJobPayloadVersion: 1,
            validationMaxAttempts: 3
        });
    });

    it("rejects missing intent, missing object, and size mismatch without completing", async () => {
        // 저장공간 시험용 객체 준비
        const storage = new ObjectDouble();
        // 저장소 시험용 완료처리 준비
        const repository = new CompletionDouble();
        // 작업 시험용 완료처리 결과 준비
        const operation = completion({ clock, policy: POLICY, storage, repository });

        // 저장소 의도를 빈 값 값으로 설정
        repository.intent = null;
        // 업로드 없음 조건을 포함한 기대 결과 일치 확인
        await expect(
            operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })
        ).resolves.toEqual({ kind: "UPLOAD_NOT_FOUND" });

        // 저장소 의도를 업로드 의도 식별자 및 익명 세션 식별자 및 객체 키 세션 영상 및 예상바이트크기 50 자료로 설정
        repository.intent = {
            uploadIntentId: INTENT_ID,
            anonymousSessionId: SESSION_ID,
            objectKey: "temporary/session/video.mp4",
            expectedSizeBytes: 50,
            declaredContentType: "video/mp4",
            competition: "K리그1",
            season: "2026",
            expiresAt: "2026-08-24T00:15:00.000Z"
        };
        // 저장공간 메타정보 결과를 빈 값 값으로 설정
        storage.headResult = null;
        // 업로드 준비 미완료 조건을 포함한 기대 결과 일치 확인
        await expect(
            operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })
        ).resolves.toEqual({ kind: "UPLOAD_NOT_READY" });

        // 저장공간 메타정보 결과를 크기 바이트 49 및 내용 해시 자료로 설정
        storage.headResult = { sizeBytes: 49, contentSha256: Uint8Array.from([1, 2, 3]) };
        // 유효하지 않은 업로드 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })
        ).resolves.toEqual({ kind: "UPLOAD_INVALID" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});
