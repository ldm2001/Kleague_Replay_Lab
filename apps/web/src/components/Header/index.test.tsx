// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./index.js";

describe("Header", () => {
  afterEach(() => {
    // 테스트 DOM과 모형 정리
    cleanup();
    vi.restoreAllMocks();
  });

  it("switches to the compact header after scrolling", () => {
    // 애니메이션 프레임 모형 구성
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    // 랜딩 헤더 렌더링
    render(<Header mode="landing" />);
    const header = document.querySelector(".site-header");
    expect(header).toHaveAttribute("data-scrolled", "false");

    Object.defineProperty(globalThis, "scrollY", { configurable: true, value: 120 });
    // 스크롤 이벤트 전달
    globalThis.dispatchEvent(new Event("scroll"));

    expect(header).toHaveAttribute("data-scrolled", "true");
  });
});
