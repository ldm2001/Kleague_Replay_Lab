// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./index.js";

type Entry = { isIntersecting: boolean; target: Element };

describe("Reveal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reveals once when the element enters the viewport", () => {
    let callback: ((entries: Entry[]) => void) | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", vi.fn((next: (entries: Entry[]) => void) => {
      callback = next;
      return { observe, unobserve, disconnect };
    }));

    render(<Reveal as="section" delay={140}><span>영상 사실</span></Reveal>);
    const element = screen.getByText("영상 사실").parentElement;
    expect(element).toHaveClass("reveal");
    expect(element).not.toHaveClass("is-visible");
    expect(element).toHaveStyle("--reveal-delay: 140ms");
    expect(observe).toHaveBeenCalledWith(element);

    callback?.([{ isIntersecting: true, target: element! }]);

    expect(element).toHaveClass("is-visible");
    expect(unobserve).toHaveBeenCalledWith(element);
  });
});
