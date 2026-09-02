// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SolutionDeck } from "./index.js";

describe("SolutionDeck", () => {
  afterEach(() => cleanup());

  it("expands the focused solution and updates its content", () => {
    render(<SolutionDeck />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "영상 근거 중심의 판정 보조" })).toBeInTheDocument();

    fireEvent.focus(tabs[1]!);

    expect(tabs[1]!).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "적용 규정과 판본 확인" })).toBeInTheDocument();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(document.getElementById("solution-panel")).toHaveClass("is-active");
  });
});
