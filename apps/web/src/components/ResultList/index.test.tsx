// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisView } from "@replay/application";
import { ResultList } from "./index.js";

const analysis = {
  analysisId: "44444444-4444-4444-8444-444444444444",
  mode: "VISUAL_CHANGE_BASELINE",
  judgmentStatus: "NOT_EVALUATED",
  status: "COMPLETED",
  stage: "SUCCEEDED",
  progressPercent: 100,
  failureCode: null,
  limitations: ["incident_category_classification_pending"],
  candidates: [{
    index: 1,
    startMs: 500,
    endMs: 1500,
    anchorMs: 1000,
    signalScore: 0.42,
    cameraSufficiency: "MEDIUM",
    reasons: ["motion-spike"],
    evidence: [],
  }],
} as unknown as AnalysisView;

describe("ResultList", () => {
  afterEach(() => cleanup());

  it("labels a baseline result without presenting a judgment confidence", () => {
    render(<ResultList analysis={analysis} />);

    expect(screen.getByText("기초 장면 탐색 완료")).toBeInTheDocument();
    expect(screen.getByText("영상 변화 구간 1건")).toBeInTheDocument();
    expect(screen.getByText("판정 미평가")).toBeInTheDocument();
    expect(screen.getByText("변화 신호")).toBeInTheDocument();
    expect(screen.queryByText("확신도")).not.toBeInTheDocument();
    expect(screen.queryByText("카메라")).not.toBeInTheDocument();
  });
});
