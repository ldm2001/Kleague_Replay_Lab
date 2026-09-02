// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadBox } from "./index.js";

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

describe("UploadBox", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uploads a video and renders the completed candidate view", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "NOT_FOUND" }), { status: 404 }))
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
          status: "COMPLETED",
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

    render(<React.StrictMode><UploadBox /></React.StrictMode>);
    const file = new File([new Uint8Array(128)], "highlight.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("영상 파일"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getAllByText("기초 장면 탐색 완료").length).toBeGreaterThan(0));
    expect(screen.getByText("후보 장면 01")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "후보 장면 01 핵심 프레임" })).toBeInTheDocument();
    expect(screen.getByLabelText("후보 장면 01 클립")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders the upload controls used by the landing page", () => {
    render(<UploadBox />);

    expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
    expect(screen.getByLabelText("대회")).toBeInTheDocument();
    expect(screen.getByLabelText("시즌")).toBeInTheDocument();
    expect(screen.getByText("낮은 확신도 장면도 표시")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeInTheDocument();
  });

  it("restores the latest completed analysis after remount", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        videoAssetId: "33333333-3333-4333-8333-333333333333",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        videoAssetId: "33333333-3333-4333-8333-333333333333",
        videoStatus: "VALID",
        validationErrorCode: null,
        analysis: {
          analysisId: "44444444-4444-4444-8444-444444444444",
          mode: "VISUAL_CHANGE_BASELINE",
          judgmentStatus: "NOT_EVALUATED",
          status: "COMPLETED",
          stage: "SUCCEEDED",
          progressPercent: 100,
          failureCode: null,
          limitations: [],
          candidates: [],
        },
      }), { status: 200 }));

    render(<React.StrictMode><UploadBox /></React.StrictMode>);

    await waitFor(() => expect(screen.getAllByText("기초 장면 탐색 완료").length).toBeGreaterThan(0));
    expect(screen.getByText("영상 변화 구간 0건")).toBeInTheDocument();
  });
});
