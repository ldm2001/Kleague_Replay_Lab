// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingPage } from "./index.js";

describe("LandingPage", () => {
  afterEach(() => cleanup());

  it("presents the adopted cloud-style landing structure with product-specific copy", () => {
    render(<LandingPage />);

    expect(existsSync(resolve("apps/web/src/assets/image/hero/kleague-ball.jpg"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/review/foul.jpg"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/review/handball.jpg"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/review/charging.webp"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/review/goal.jpg"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/brand/kleague-logo.png"))).toBe(true);
    expect(existsSync(resolve("apps/web/src/assets/image/brand/kleague-logo-light.png"))).toBe(true);
    expect(screen.getByRole("heading", { name: "경기 판정의 새로운 근거를 열다" })).toBeInTheDocument();
    expect(screen.getByTestId("hero-art")).toHaveAttribute("src", "/apps/web/src/assets/image/hero/kleague-ball.jpg");
    expect(screen.getByTestId("site-logo")).toHaveAttribute("src", "/apps/web/src/assets/image/brand/kleague-logo-light.png");
    expect(screen.getByRole("link", { name: "솔루션" })).toHaveAttribute("href", "#solutions");
    expect(screen.getByRole("link", { name: "분석 기능" })).toHaveAttribute("href", "#services");
    expect(screen.getByRole("link", { name: "규정" })).toHaveAttribute("href", "#rules");
    expect(screen.queryByRole("link", { name: "분석 시작" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "주요 분석 기능" })).toBeInTheDocument();
    expect(screen.getByText("판정 후보 탐지")).toBeInTheDocument();
    expect(screen.getByText("IFAB와 K리그 요강 대조")).toBeInTheDocument();
    expect(screen.getByText("근거 프레임과 클립")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "파울 판정 예시" })).toHaveAttribute("src", "/apps/web/src/assets/image/review/foul.jpg");
    expect(screen.getByRole("img", { name: "핸드볼 판정 예시" })).toHaveAttribute("src", "/apps/web/src/assets/image/review/handball.jpg");
    expect(screen.getByRole("img", { name: "차징과 터치 판정 예시" })).toHaveAttribute("src", "/apps/web/src/assets/image/review/charging.webp");
    expect(screen.getByRole("img", { name: "득점 취소 판정 예시" })).toHaveAttribute("src", "/apps/web/src/assets/image/review/goal.jpg");
    expect(screen.getAllByRole("link", { name: "영상 분석 시작하기" }).every((link) => link.getAttribute("href") === "/analyze")).toBe(true);
    expect(screen.getAllByRole("link", { name: "분석 흐름 보기" }).every((link) => link.getAttribute("href") === "/analyze")).toBe(true);
    expect(screen.queryByRole("heading", { name: "경기 영상 업로드" })).not.toBeInTheDocument();
  });
});
