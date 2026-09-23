// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "./index.js";

// 시험자료 호출 여부와 전달 인자를 기록할 모의함수 생성
const preview = vi.fn((file: File) => `blob:${file.name}`);
// 시험자료 호출 여부와 전달 인자를 기록할 모의함수 생성
const release = vi.fn();

class FakeUploadRequest {
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
    send() {
        // 입력 조건 결과 처리 수행
        this.onprogress?.({ loaded: 128, total: 128 });
        // 입력 조건 결과 처리 수행
        this.onload?.();
    }

    // 검증용 취소 구성
    abort() {
        // 입력 조건 결과 처리 수행
        this.onabort?.();
    }
}

// 업로드 패널 테스트
describe("UploadPanel", () => {
    beforeEach(() => {
        // 객체 결과 처리 수행
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: preview });
        // 객체 결과 처리 수행
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: release });
        // 시험도구 모의함수 반환값 모의동작 결과 처리 수행
        preview.mockClear();
        // 시험도구 모의함수 반환값 모의동작 결과 처리 수행
        release.mockClear();
    });

    afterEach(() => {
        // 이전 시험에서 렌더링한 화면 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
    });

    // 선택과 업로드 분리 확인
    it("uploads only after the analysis button is pressed", async () => {
        // 화면자료 호출 여부와 전달 인자를 기록할 모의함수 생성
        const onView = vi.fn();
        // 시험도구 전역값대체 결과 처리 수행
        vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
        // 시험도구 호출감시 결과 일회응답설정 결과 일회응답설정 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        kind: "CREATED",
                        uploadIntentId: "22222222-2222-4222-8222-222222222222",
                        uploadUrl: "http://minio.test/upload-token"
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
                            status: "CANDIDATES_READY",
                            stage: "SUCCEEDED",
                            progressPercent: 100,
                            failureCode: null,
                            limitations: ["incident_category_classification_pending"],
                            candidates: [
                                {
                                    index: 1,
                                    startMs: 500,
                                    endMs: 1500,
                                    anchorMs: 1000,
                                    confidence: 0.42,
                                    cameraSufficiency: "MEDIUM",
                                    reasons: ["motion-spike"],
                                    evidence: [
                                        {
                                            evidenceId: "55555555-5555-4555-8555-555555555555",
                                            kind: "FRAME"
                                        },
                                        {
                                            evidenceId: "66666666-6666-4666-8666-666666666666",
                                            kind: "CLIP"
                                        }
                                    ]
                                }
                            ]
                        }
                    }),
                    { status: 200 }
                )
            );

        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <React.StrictMode>
                <UploadPanel onView={onView} />
            </React.StrictMode>
        );
        // 시험자료 시험용 의존성 모의객체 준비
        const file = new File([new Uint8Array(128)], "highlight.mp4", { type: "video/mp4" });
        // 화면의 영상 파일 요소에 사용자 변경 이벤트 전달
        fireEvent.change(screen.getByLabelText("영상 파일"), { target: { files: [file] } });

        // 통신함수의 미호출 확인
        expect(fetch).not.toHaveBeenCalled();
        // 화면의 선택 영상 미리보기 요소의 지정 속성 적용 확인
        expect(screen.getByLabelText("선택 영상 미리보기")).toHaveAttribute(
            "src",
            "blob:highlight.mp4"
        );
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("highlight.mp4")).toBeInTheDocument();
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText(/128 B/)).toBeInTheDocument();

        // 화면의 분석 시작 요소에 사용자 클릭 이벤트 전달
        fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(screen.getAllByText("기초 장면 탐색 완료").length).toBeGreaterThan(0)
        );
        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(onView).toHaveBeenCalledWith(
                expect.objectContaining({ videoAssetId: "33333333-3333-4333-8333-333333333333" })
            )
        );
        // 시험자료 시험용 응답본문 해석 결과 준비
        const uploaded = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
        // 응답본문 해석 반환값의 대회 항목 없음 확인
        expect(uploaded).not.toHaveProperty("competition");
        // 응답본문 해석 반환값의 시즌 항목 없음 확인
        expect(uploaded).not.toHaveProperty("season");
        // 화면의 후보 장면 01 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("후보 장면 01")).not.toBeInTheDocument();
        // 통신함수의 호출 횟수 3 확인
        expect(fetch).toHaveBeenCalledTimes(3);
        // 화면 역할요소조회 결과의 지정 속성 적용 확인
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    // 초기 화면 확인
    it("renders the upload controls used by the landing page", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<UploadPanel />);

        // 화면의 경기 영상 업로드 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        // 화면의 분석 시작 요소의 비활성화 상태 확인
        expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();
    });

    // 미리보기 해제 확인
    it("releases previews when the file changes and the component closes", () => {
        // 화면자료 시험용 화면렌더링 결과 준비
        const view = render(<UploadPanel />);
        // 입력 시험용 화면의 영상 파일 요소 준비
        const input = screen.getByLabelText("영상 파일");

        // 입력에 사용자 변경 이벤트 전달
        fireEvent.change(input, {
            target: { files: [new File(["a"], "first.mp4", { type: "video/mp4" })] }
        });
        // 입력에 사용자 변경 이벤트 전달
        fireEvent.change(input, {
            target: { files: [new File(["b"], "second.mp4", { type: "video/mp4" })] }
        });

        // 시험도구 모의함수 반환값의 첫결과 인자 전달 확인
        expect(release).toHaveBeenCalledWith("blob:first.mp4");
        // 화면자료 결과 처리 수행
        view.unmount();
        // 시험도구 모의함수 반환값의 두번째결과 인자 전달 확인
        expect(release).toHaveBeenCalledWith("blob:second.mp4");
    });

    // 이전 결과 복원 없음 확인
    it("starts without a previous analysis after remount", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <React.StrictMode>
                <UploadPanel />
            </React.StrictMode>
        );

        // 화면의 분석 결과 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "분석 결과" })).not.toBeInTheDocument();
    });

    // 드롭도 파일 선택과 같은 미리보기 단계로 진입
    it("영상 드롭", () => {
        // 시험자료 시험용 시험도구 호출감시 결과 준비
        const network = vi.spyOn(globalThis, "fetch");
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<UploadPanel />);
        // 시험자료 시험용 의존성 모의객체 준비
        const file = new File(["video"], "drop.mp4", { type: "video/mp4" });
        // 시험자료 시험용 화면의 영상 파일 요소 요소 준비
        const picker = screen.getByLabelText("영상 파일").parentElement!;
        // 시험자료에 사용자 조작 이벤트 전달
        fireEvent.drop(picker, { dataTransfer: { files: [file] } });
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("drop.mp4")).toBeInTheDocument();
        // 화면의 선택 영상 미리보기 요소의 지정 속성 적용 확인
        expect(screen.getByLabelText("선택 영상 미리보기")).toHaveAttribute("src", "blob:drop.mp4");
        // 시험도구 반환값의 미호출 확인
        expect(network).not.toHaveBeenCalled();
    });

    it("지원하지 않는 파일 드롭", () => {
        // 시험자료 시험용 시험도구 호출감시 결과 준비
        const network = vi.spyOn(globalThis, "fetch");
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<UploadPanel />);
        // 화면의 영상 파일 요소 요소에 사용자 조작 이벤트 전달
        fireEvent.drop(screen.getByLabelText("영상 파일").parentElement!, {
            dataTransfer: { files: [new File(["data"], "notes.txt", { type: "text/plain" })] }
        });
        // 화면의 분석 시작 요소의 비활성화 상태 확인
        expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();
        // 화면 역할요소조회 결과의 지정 문자열 문구 표시 확인
        expect(screen.getByRole("alert")).toHaveTextContent("MP4와 MOV와 WEBM");
        // 시험도구 반환값의 미호출 확인
        expect(network).not.toHaveBeenCalled();
    });
});
