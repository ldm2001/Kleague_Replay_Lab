// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadBox } from "./upload-box.js";

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

  it("performs one create, one direct upload, and one complete request", async () => {
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
      }), { status: 202 }));

    render(<UploadBox />);
    const file = new File([new Uint8Array(128)], "highlight.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("영상 파일"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getAllByText("검증 대기").length).toBeGreaterThan(0));
    expect(fetch).toHaveBeenCalledTimes(2);
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
});
