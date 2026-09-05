// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseSlider } from "./index.js";

const items = [
  { title: "파울", text: "접촉과 강도를 확인합니다", tone: "blue", image: "/foul.jpg" },
  { title: "핸드볼", text: "공과 팔의 위치를 확인합니다", tone: "red", image: "/handball.jpg" },
  { title: "차징과 터치", text: "경합과 마지막 터치를 확인합니다", tone: "green", image: "/charging.webp" },
  { title: "득점 취소", text: "득점 직전 상황을 확인합니다", tone: "violet", image: "/goal.jpg" },
] as const;

describe("CaseSlider", () => {
  afterEach(() => {
    // 테스트 DOM과 모형 정리
    cleanup();
    vi.restoreAllMocks();
  });

  it("moves the review range strip with the navigation buttons", () => {
    // 스크롤 모형 구성
    Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: () => undefined });
    // 검토 범위 슬라이더 렌더링
    const scrollBy = vi.spyOn(HTMLElement.prototype, "scrollBy").mockImplementation(() => undefined);
    render(<CaseSlider items={items} />);

    expect(screen.getByRole("button", { name: "이전 검토 범위" })).toBeDisabled();
    // 다음 카드 이동
    fireEvent.click(screen.getByRole("button", { name: "다음 검토 범위" }));

    expect(scrollBy).toHaveBeenCalledWith({ left: 340, behavior: "smooth" });
    expect(screen.getByRole("button", { name: "이전 검토 범위" })).not.toBeDisabled();
  });
});
