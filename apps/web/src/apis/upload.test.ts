import { describe, expect, it } from "vitest";
import { completion, upload, type UploadApiDependencies } from "./upload.js";

// 세션 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// 의도 식별자 시험용 22222222 2222 4222 8222 222222222222 준비
const INTENT_ID = "22222222-2222-4222-8222-222222222222";
// 영상 식별자 시험용 33333333 3333 4333 8333 333333333333 준비
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";

// 업로드 요청 경로 의존성 모형
const dependencies = (): UploadApiDependencies => ({
    issue: async () => ({ sessionId: SESSION_ID, token: "session-token" }),
    resolve: async () => ({ sessionId: SESSION_ID }),
    upload: async () => ({
        kind: "CREATED",
        uploadIntentId: INTENT_ID,
        objectKey: "uploads/session/object.upload",
        uploadUrl: "http://minio.test/upload-token",
        expiresAt: "2030-01-01T13:00:00.000Z",
    }),
    complete: async () => ({ kind: "COMPLETED", videoAssetId: VIDEO_ID }),
});

describe("upload API", () => {
    it("issues an HttpOnly session cookie only when a new session is needed", async () => {
        // 새 익명 세션 업로드 요청 구성
        const response = await upload(
            new Request("http://localhost/api/uploads", {
                method: "POST",
                body: JSON.stringify({
                    expectedSizeBytes: 128,
                    declaredContentType: "video/mp4",
                    rightsConfirmed: true
                }),
                headers: { "content-type": "application/json" }
            }),
            { ...dependencies(), resolve: async () => null }
        );

        // 응답 상태의 기대값 201 일치 확인
        expect(response.status).toBe(201);
        // 응답 응답헤더 조회 결과의 재생 세션 세션 토큰 포함 확인
        expect(response.headers.get("set-cookie")).toContain("replay_session=session-token");
        // 응답 응답헤더 조회 결과의 지정 문자열 포함 확인
        expect(response.headers.get("set-cookie")).toContain("HttpOnly");
        // 응답 응답본문 결과의 종류 생성완료 및 업로드 의도 식별자 자료의 필드 일치 확인
        expect(await response.json()).toMatchObject({ kind: "CREATED", uploadIntentId: INTENT_ID });
    });

    it("does not issue a session or call the use case for invalid JSON", async () => {
        // 잘못된 본문 요청 구성
        let called = false;
        // 의존성 시험 입력으로 기존 항목 및 업로드 자료 생성
        const deps = {
            ...dependencies(),
            upload: async () => {
                // 호출여부를 참 값으로 설정
                called = true;
                // 종류 자료 반환
                return { kind: "SESSION_UNAVAILABLE" as const };
            }
        };

        // 업로드 결과를 응답에 저장
        const response = await upload(
            new Request("http://localhost/api/uploads", { method: "POST", body: "not-json" }),
            deps
        );

        // 응답 상태의 기대값 400 일치 확인
        expect(response.status).toBe(400);
        // 호출여부의 기대값 거짓 일치 확인
        expect(called).toBe(false);
        // 응답 응답헤더 조회 결과의 빈 값 확인
        expect(response.headers.get("set-cookie")).toBeNull();
    });
});

describe("complete API", () => {
    it("returns unauthorized without a valid session", async () => {
        // 세션 없는 완료 요청 구성
        const deps = { ...dependencies(), resolve: async () => null };

        // 완료처리 결과를 응답에 저장
        const response = await completion(
            new Request("http://localhost/api/uploads/intent/complete", { method: "POST" }),
            { intentId: INTENT_ID },
            deps
        );

        // 응답 상태의 기대값 401 일치 확인
        expect(response.status).toBe(401);
        // 응답 응답본문 결과의 종류 인증실패 자료 기준 구조 일치 확인
        expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
    });

    it("returns an accepted completion response without adding layout concerns to the API", async () => {
        // 세션 있는 완료 요청 구성
        const response = await completion(
            new Request("http://localhost/api/uploads/intent/complete", {
                method: "POST",
                headers: { cookie: "replay_session=session-token" }
            }),
            { intentId: INTENT_ID },
            dependencies()
        );

        // 응답 상태의 기대값 202 일치 확인
        expect(response.status).toBe(202);
        // 응답 응답본문 결과의 종류 완료 및 영상 자산 식별자 자료 기준 구조 일치 확인
        expect(await response.json()).toEqual({ kind: "COMPLETED", videoAssetId: VIDEO_ID });
    });
});
