// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "./index.js";

const preview = vi.fn((file: File) => `blob:${file.name}`);
const release = vi.fn();

class FakeUploadRequest {
  onprogress: ((event: { loaded: number; total: number }) => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  upload = this;
  status = 200;

  open() {}
  setRequestHeader() {}
  send() {
    this.onprogress?.({ loaded: 128, total: 128 });
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

// 업로드 패널 테스트
describe("UploadPanel", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: preview });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: release });
    preview.mockClear();
    release.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // 선택과 업로드 분리 확인
  it("uploads only after the analysis button is pressed", async () => {
    const onView = vi.fn();
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "CREATED",
        uploadIntentId: "22222222-2222-4222-8222-222222222222",
        uploadUrl: "http://minio.test/upload-token",
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "COMPLETED",
        videoAssetId: "33333333-3333-4333-8333-333333333333",
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
          candidates: [{
            index: 1,
            startMs: 500,
            endMs: 1500,
            anchorMs: 1000,
            confidence: 0.42,
            cameraSufficiency: "MEDIUM",
            reasons: ["motion-spike"],
            evidence: [
              { evidenceId: "55555555-5555-4555-8555-555555555555", kind: "FRAME" },
              { evidenceId: "66666666-6666-4666-8666-666666666666", kind: "CLIP" },
            ],
          }],
        },
      }), { status: 200 }));

    render(<React.StrictMode><UploadPanel onView={onView} /></React.StrictMode>);
    const file = new File([new Uint8Array(128)], "highlight.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("영상 파일"), { target: { files: [file] } });

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("선택 영상 미리보기")).toHaveAttribute("src", "blob:highlight.mp4");
    expect(screen.getByText("highlight.mp4")).toBeInTheDocument();
    expect(screen.getByText(/128 B/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => expect(screen.getAllByText("기초 장면 탐색 완료").length).toBeGreaterThan(0));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ videoAssetId: "33333333-3333-4333-8333-333333333333" }), true);
    expect(screen.queryByText("후보 장면 01")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  // 초기 화면 확인
  it("renders the upload controls used by the landing page", () => {
    render(<UploadPanel />);

    expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
    expect(screen.getByLabelText("대회")).toBeInTheDocument();
    expect(screen.getByLabelText("시즌")).toBeInTheDocument();
    expect(screen.getByText("낮은 확신도 장면도 표시")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();
  });

  // 미리보기 해제 확인
  it("releases previews when the file changes and the component closes", () => {
    const view = render(<UploadPanel />);
    const input = screen.getByLabelText("영상 파일");

    fireEvent.change(input, { target: { files: [new File(["a"], "first.mp4", { type: "video/mp4" })] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "second.mp4", { type: "video/mp4" })] } });

    expect(release).toHaveBeenCalledWith("blob:first.mp4");
    view.unmount();
    expect(release).toHaveBeenCalledWith("blob:second.mp4");
  });

  // 이전 결과 복원 없음 확인
  it("starts without a previous analysis after remount", () => {
    render(<React.StrictMode><UploadPanel /></React.StrictMode>);

    expect(screen.queryByRole("region", { name: "분석 결과" })).not.toBeInTheDocument();
  });

  // 드롭도 파일 선택과 같은 미리보기 단계로 진입
  it("영상 드롭", () => {
    const network = vi.spyOn(globalThis, "fetch");
    render(<UploadPanel />);
    const file = new File(["video"], "drop.mp4", { type: "video/mp4" });
    const picker = screen.getByLabelText("영상 파일").parentElement!;
    fireEvent.drop(picker, { dataTransfer: { files: [file] } });
    expect(screen.getByText("drop.mp4")).toBeInTheDocument();
    expect(screen.getByLabelText("선택 영상 미리보기")).toHaveAttribute("src", "blob:drop.mp4");
    expect(network).not.toHaveBeenCalled();
  });

  it("지원하지 않는 파일 드롭", () => {
    const network = vi.spyOn(globalThis, "fetch");
    render(<UploadPanel />);
    fireEvent.drop(screen.getByLabelText("영상 파일").parentElement!, { dataTransfer: { files: [new File(["data"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("MP4와 MOV와 WEBM");
    expect(network).not.toHaveBeenCalled();
  });
});
