// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./index.js";

describe("Header", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("switches to the compact header after scrolling", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<Header mode="landing" />);
    const header = document.querySelector(".site-header");
    expect(header).toHaveAttribute("data-scrolled", "false");

    Object.defineProperty(globalThis, "scrollY", { configurable: true, value: 120 });
    globalThis.dispatchEvent(new Event("scroll"));

    expect(header).toHaveAttribute("data-scrolled", "true");
  });
});
