// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analysis, candidate, judgment } from "../../../test/fixtures/result";
import { RulePanel } from "./index";

describe("RulePanel", () => {
  afterEach(() => cleanup());

  it("shows a pending state without inventing a decision", () => {
    render(<RulePanel analysis={analysis()} candidate={candidate(0)} />);
    expect(screen.getByText("영상 사실 추출 대기")).toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
  });

  it("separates facts IFAB K League and VAR evidence", () => {
    render(<RulePanel analysis={analysis()} candidate={candidate(1, judgment)} />);
    expect(screen.getByRole("region", { name: "확인된 사실" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "IFAB 규정" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "K리그 대회요강" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "VAR 검토" })).toBeInTheDocument();
  });
});
