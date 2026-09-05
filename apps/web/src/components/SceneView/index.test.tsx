// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analysis } from "../../../test/fixtures/result";
import { SceneView } from "./index";

// 장면 보기 테스트
describe("SceneView", () => {
  afterEach(() => {
    // 테스트 DOM 정리
    cleanup();
  });

  it("moves one scene with buttons and arrow keys", () => {
    // 장면 캐러셀 렌더링
    render(<SceneView analysis={analysis()} />);
    expect(screen.getByText("01 / 03")).toBeInTheDocument();
    // 다음 장면 버튼 이동
    fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    // 키보드 다음 장면 이동
    fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowRight" });
    expect(screen.getByText("03 / 03")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 장면" })).toBeDisabled();
  });

  it("renders only one video element for the selected scene", () => {
    // 선택 장면 미디어 렌더링
    const { container } = render(<SceneView analysis={analysis()} />);
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });
});
