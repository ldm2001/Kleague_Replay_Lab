// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisView } from "./index.js";

// 추가 시험용 시험도구 선행초기화 결과 준비
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
// 시험도구 모의동작 결과 처리 수행
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

class UploadRequest {
    onprogress: ((event: { loaded: number; total: number }) => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload = this;
    status = 200;

    // 검증용 연결 구성
    open() {}

    // 검증용 요청 헤더 설정 구성
    setRequestHeader() {}

    // 검증용 전송 구성
    send() { this.onprogress?.({ loaded: 128, total: 128 }); this.onload?.(); }

    // 검증용 취소 구성
    abort() { this.onabort?.(); }
}

// 분석 화면 테스트
describe("AnalysisView", () => {
    afterEach(() => {
        // 테스트 문서 구조과 모형 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
        // 추가 모의동작 결과 처리 수행
        push.mockReset();
    });

    // 업로드 화면 확인
    it("presents the upload flow on its own analysis page", () => {
        // 분석 화면 렌더링
        render(<AnalysisView />);

        // 화면의 리그 판정 보조 홈 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "K리그 판정 보조 홈" })).toHaveAttribute(
            "href",
            "/"
        );
        // 화면 시험표지조회 결과의 지정 속성 적용 확인
        expect(screen.getByTestId("site-logo")).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/brand/kleague-logo.png"
        );
        // 화면의 분석할 영상을 요소의 화면 표시 확인
        expect(screen.getByText("분석할 영상을")).toBeInTheDocument();
        // 화면의 지금 준비하세요 요소의 화면 표시 확인
        expect(screen.getByText("지금 준비하세요")).toBeInTheDocument();
        // 화면의 경기 영상 업로드 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
        // 화면의 영상 파일 요소의 화면 표시 확인
        expect(screen.getByLabelText("영상 파일")).toBeInTheDocument();
        // 화면의 분석 시작 요소의 화면 표시 확인
        expect(screen.getByRole("button", { name: "분석 시작" })).toBeInTheDocument();
    });

    // 완료 후 결과 이동 확인
    it.each(["CANDIDATES_READY", "COMPLETED"])("설정 없이 결과 이동 %s", async (status) => {
        // 업로드 모형 구성
        vi.stubGlobal("XMLHttpRequest", UploadRequest);
        // 객체 결과 처리 수행
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn(() => "blob:match.mp4")
        });
        // 객체 결과 처리 수행
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        // 시험도구 호출감시 결과 일회응답설정 결과 일회응답설정 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        kind: "CREATED",
                        uploadIntentId: "22222222-2222-4222-8222-222222222222",
                        uploadUrl: "http://storage.test/upload"
                    }),
                    { status: 201 }
                )
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        kind: "COMPLETED",
                        videoAssetId: "33333333-3333-4333-8333-333333333333"
                    }),
                    { status: 202 }
                )
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        videoAssetId: "33333333-3333-4333-8333-333333333333",
                        videoStatus: "VALID",
                        validationErrorCode: null,
                        analysis: {
                            analysisId: "44444444-4444-4444-8444-444444444444",
                            mode: "VISUAL_CHANGE_BASELINE",
                            judgmentStatus: "NOT_EVALUATED",
                            status,
                            stage: "SUCCEEDED",
                            progressPercent: 100,
                            failureCode: null,
                            limitations: [],
                            candidates: []
                        }
                    }),
                    { status: 200 }
                )
            );

        // 분석 화면 렌더링
        render(<AnalysisView />);
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        // 영상 선택 이벤트 전달
        fireEvent.change(screen.getByLabelText("영상 파일"), {
            target: { files: [new File([new Uint8Array(128)], "match.mp4", { type: "video/mp4" })] }
        });
        // 분석 시작 이벤트 전달
        fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(push).toHaveBeenCalledWith("/results/44444444-4444-4444-8444-444444444444")
        );
    });
});
