// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analysis } from "../../../test/fixtures/result";
import { SceneView } from "./index";

// 장면 보기 테스트
describe("SceneView", () => {
  afterEach(() => cleanup());

  it("moves one scene with buttons and arrow keys", () => {
    render(<SceneView analysis={analysis()} />);
    expect(screen.getByText("01 / 03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowRight" });
    expect(screen.getByText("03 / 03")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 장면" })).toBeDisabled();
  });

  it("renders only one video element for the selected scene", () => {
    const { container } = render(<SceneView analysis={analysis()} />);
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });
});
