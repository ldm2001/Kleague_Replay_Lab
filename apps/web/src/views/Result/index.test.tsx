// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysis as resultFixture } from "../../../test/fixtures/result";
import { ResultView } from "./index";

const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const view = resultFixture();

// 결과 화면 테스트
describe("ResultView", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // 요청 분석 조회 확인
  it("loads the requested analysis instead of the latest analysis", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }));
    render(<ResultView analysisId={ANALYSIS} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "영상 검토 결과" })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(`/api/analyses/${ANALYSIS}`, expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute("href", "/analyze");
    expect(screen.getByLabelText("장면 캐러셀")).toBeInTheDocument();
  });

  // 결과 오류 화면 확인
  it("shows a scoped error state when the result cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ kind: "NOT_FOUND" }), { status: 404 }));
    render(<ResultView analysisId={ANALYSIS} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "결과를 불러오지 못했습니다" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "분석 페이지로 이동" })).toHaveAttribute("href", "/analyze");
  });

  it("shows results without configuration or fact entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(view)));
    render(<ResultView analysisId={ANALYSIS} />);
    await waitFor(() => expect(screen.getByText("01 / 03")).toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/아래에서 장면의 접촉/)).not.toBeInTheDocument();
  });
});
