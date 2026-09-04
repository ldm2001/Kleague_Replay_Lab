// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysis } from "../../../test/fixtures/result";
import { SceneRail } from "./index";

describe("SceneRail", () => {
  afterEach(() => cleanup());

  it("selects a candidate and marks the active row", () => {
    const select = vi.fn();
    const view = analysis();
    render(<SceneRail analysisId={view.analysisId} candidates={view.candidates} active={1} onSelect={select} />);

    expect(screen.getByRole("button", { name: /후보 장면 02/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /후보 장면 03/ }));
    expect(select).toHaveBeenCalledWith(2);
  });
});
