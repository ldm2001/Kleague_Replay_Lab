// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysis } from "../../../test/fixtures/result";
import { SceneList } from "./index";

// 장면 목록 테스트
describe("SceneList", () => {
  afterEach(() => {
    // 테스트 DOM 정리
    cleanup();
  });

  it("selects a candidate and marks the active row", () => {
    // 후보 목록 모형 준비
    const select = vi.fn();
    const view = analysis();
    render(<SceneList analysisId={view.analysisId} candidates={view.candidates} active={1} onSelect={select} />);

    expect(screen.getByRole("button", { name: /후보 장면 02/ })).toHaveAttribute("aria-current", "true");
    // 후보 선택 이벤트 전달
    fireEvent.click(screen.getByRole("button", { name: /후보 장면 03/ }));
    expect(select).toHaveBeenCalledWith(2);
  });
});
