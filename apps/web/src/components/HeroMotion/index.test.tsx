// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroMotion } from "./index.js";

describe("HeroMotion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("marks the hero as scrolled without subscribing React state", () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<HeroMotion><span>경기 판정</span></HeroMotion>);
    const hero = document.querySelector(".hero");
    expect(hero).toHaveAttribute("data-scrolled", "false");

    Object.defineProperty(globalThis, "scrollY", { configurable: true, value: 120 });
    globalThis.dispatchEvent(new Event("scroll"));

    expect(hero).toHaveAttribute("data-scrolled", "true");
  });
});
