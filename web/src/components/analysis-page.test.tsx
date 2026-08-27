// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisPage } from "./analysis-page.js";

describe("AnalysisPage", () => {
  afterEach(() => cleanup());

  it("presents the upload flow on its own analysis page", () => {
    render(<AnalysisPage />);

    expect(screen.getByRole("link", { name: "K리그 판정 보조 홈" })).toHaveAttribute("href", "/");
    expect(screen.getByTestId("site-logo")).toHaveAttribute("src", "/web/src/assets/brand/kleague-logo.png");
    expect(screen.getByText("분석할 영상을")).toBeInTheDocument();
    expect(screen.getByText("지금 준비하세요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "경기 영상 업로드" })).toBeInTheDocument();
    expect(screen.getByLabelText("영상 파일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeInTheDocument();
  });
});
