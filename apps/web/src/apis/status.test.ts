import { describe, expect, it } from "vitest";
import { media, recent, type StatusApiDependencies } from "./status.js";
import type { MediaView } from "@replay/application";

// 화면자료 시험 입력으로 영상 자산 식별자 11111111 1111 4111 8111 111111111111 및 영상 상태 유효 및 오류객체 코드 빈 값 및 분석 빈 값 자료 생성
const view: MediaView = {
    videoAssetId: "11111111-1111-4111-8111-111111111111",
    videoStatus: "VALID",
    validationErrorCode: null,
    analysis: null,
};

// 상태 요청 경로 의존성 모형
const dependencies: StatusApiDependencies = {
    resolve: async (token) =>
        token === "session-token" ? { sessionId: "33333333-3333-4333-8333-333333333333" } : null,
    status: async () => view,
    latest: async () => ({ videoAssetId: "11111111-1111-4111-8111-111111111111" })
};

// 영상 상태 요청 경로 테스트
describe("media status API", () => {
    it("returns an owned media view", async () => {
        // 소유 영상 상태 요청 구성
        const response = await media(
            new Request("http://localhost/api/uploads/11111111-1111-4111-8111-111111111111", {
                headers: { cookie: "replay_session=session-token" }
            }),
            { videoAssetId: "11111111-1111-4111-8111-111111111111" },
            dependencies
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 화면자료 기준 구조 일치 확인
        expect(await response.json()).toEqual(view);
    });

    it("rejects a missing anonymous session", async () => {
        // 세션 없는 상태 요청 구성
        const response = await media(
            new Request("http://localhost/api/uploads/11111111-1111-4111-8111-111111111111"),
            { videoAssetId: "11111111-1111-4111-8111-111111111111" },
            dependencies
        );

        // 응답 상태의 기대값 401 일치 확인
        expect(response.status).toBe(401);
    });

    it("returns the latest owned video identifier", async () => {
        // 최근 영상 요청 구성
        const response = await recent(
            new Request("http://localhost/api/uploads/latest", {
                headers: { cookie: "replay_session=session-token" }
            }),
            dependencies
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 영상 자산 식별자 11111111 1111 4111 8111 111111111111 자료 기준 구조 일치 확인
        expect(await response.json()).toEqual({
            videoAssetId: "11111111-1111-4111-8111-111111111111"
        });
    });
});
