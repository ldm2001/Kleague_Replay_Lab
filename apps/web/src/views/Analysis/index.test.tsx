// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisView } from "./index.js";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

class UploadRequest {
  onprogress: ((event: { loaded: number; total: number }) => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload = this;
  status = 200;
  open() {}
  setRequestHeader() {}
  send() { this.onprogress?.({ loaded: 128, total: 128 }); this.onload?.(); }
  abort() { this.onabort?.(); }
}

// 분석 화면 테스트
describe("AnalysisView", () => {
  afterEach(() => {
    // 테스트 DOM과 모형 정리
    cleanup();
    vi.restoreAllMocks();
    push.mockReset();
  });

  // 업로드 화면 확인
  it("presents the upload flow on its own analysis page", () => {
    // 분석 화면 렌더링
    render(<AnalysisView />);

    expect(screen.getByRole("link", { name: "K리그 판정 보조 홈" })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("site-logo")).toHaveAttribute("src", "/apps/web/src/assets/image/brand/kleague-logo.png");
    expect(screen.getByText("분석할 영상을")).toBeInTheDocument();
    expect(screen.getByText("지금 준비하세요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
    expect(screen.getByLabelText("영상 파일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeInTheDocument();
  });

  // 완료 후 결과 이동 확인
  it.each(["CANDIDATES_READY", "COMPLETED"])("설정 없이 결과 이동 %s", async (status) => {
    // 업로드 모형 구성
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:match.mp4") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "CREATED", uploadIntentId: "22222222-2222-4222-8222-222222222222", uploadUrl: "http://storage.test/upload" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "COMPLETED", videoAssetId: "33333333-3333-4333-8333-333333333333" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
          candidates: [],
        },
      }), { status: 200 }));

    // 분석 화면 렌더링
    render(<AnalysisView />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // 영상 선택 이벤트 전달
    fireEvent.change(screen.getByLabelText("영상 파일"), { target: { files: [new File([new Uint8Array(128)], "match.mp4", { type: "video/mp4" })] } });
    // 분석 시작 이벤트 전달
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/44444444-4444-4444-8444-444444444444"));
  });
});
