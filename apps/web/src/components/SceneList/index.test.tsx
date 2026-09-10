// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VarScopeEvaluation } from "@replay/shared-types";
import { analysis, judgment } from "../../../test/fixtures/result";
import { SceneList } from "./index";

// UI 표시 전용 서버 응답 모형이며 실제 영상 출처 일치나 규정 평가를 검증하지 않는다.
const completedScope: VarScopeEvaluation = {
  kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED", included: true,
  question: "득점 관련 장면이 대회 VAR 적용 범위에 포함되는가?",
  explanation: "대회요강의 득점 관련 범위에 포함됩니다",
  competition: "K리그1", season: "2026", ruleVersionId: "ui-only-competition-rule",
  citations: [], evidenceIds: [],
  notAssessed: ["FOUL_DECISION", "REFEREE_DECISION_CORRECTNESS", "VAR_CHECK_PERFORMED", "VAR_INTERVENTION_NECESSITY", "REVIEW_TIME_WINDOW", "IFAB_EDITION_ADOPTION"],
  provenance: {
    origin: "VIDEO_CUE_AND_COMPETITION_RULES", evaluatorVersion: "competition-var-scope-v1",
    sourceSha256: "a".repeat(64), matchKey: "ui-only-match", sourceUrls: ["https://example.test/ui-only-source"],
    cueMethod: "broadcast-goal-glyphs-v1", cueStartMs: 0, cueEndMs: 1000, ruleDocumentSha256: "b".repeat(64),
  },
};

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

  it.each([
    { name: "without a saved judgment", savedJudgment: null },
    { name: "with a saved judgment", savedJudgment: judgment },
  ])("prioritizes completed scope over an undetermined foul filter $name", ({ savedJudgment }) => {
    const select = vi.fn();
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!, signalScore: 0, judgment: savedJudgment, varScopeEvaluation: completedScope,
      filter: {
        filterVersion: "pipeline-rules-v3", status: "UNDETERMINED",
        reasonCodes: ["CONTACT_UNOBSERVED"], missingFields: ["contact"], evidenceIds: [], ruleReferences: [],
      } as const,
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={select} />);

    const row = screen.getByRole("button", { name: /득점 관련 장면 01/ });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("범위 평가 완료")).toBeInTheDocument();
    expect(screen.getByText("범위 평가")).toBeInTheDocument();
    expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("화면 변화 점수이며 파울 확률이 아님")).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(select).toHaveBeenCalledWith(0);
  });

  it("labels a server-observed corner and keeps playback selection", () => {
    const select = vi.fn();
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!,
      sceneEvent: {
        kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
        startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000],
      } as const,
      filter: {
        filterVersion: "pipeline-rules-v3", status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true,
        reasonCodes: [], missingFields: [], evidenceIds: [], ruleReferences: [],
      } as const,
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: /코너킥 장면 01/ }));
    expect(select).toHaveBeenCalledWith(0);
    expect(screen.getByText("재개 장면 관찰 · 참고 규정")).toBeInTheDocument();
    expect(screen.queryByLabelText("화면 변화 점수이며 파울 확률이 아님")).not.toBeInTheDocument();
    expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
  });

  it("does not reuse stale corner evidence-unavailable text for a completed scope with a clip", () => {
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!, varScopeEvaluation: completedScope,
      evidence: view.candidates[0]!.evidence!.filter((item) => item.kind === "CLIP"),
      sceneEvent: {
        kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
        startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000],
      } as const,
      filter: {
        filterVersion: "pipeline-rules-v3", status: "UNDETERMINED",
        reasonCodes: ["EVIDENCE_UNAVAILABLE"], missingFields: [], evidenceIds: [], ruleReferences: [],
      } as const,
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={vi.fn()} />);

    expect(screen.queryByText("영상 근거 없음")).not.toBeInTheDocument();
    expect(screen.queryByText("영상 근거 제공 불가")).not.toBeInTheDocument();
    expect(screen.getByText("프레임 준비 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /득점 관련 장면 01/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("범위 평가 완료")).toBeInTheDocument();
  });

  it("labels unavailable video evidence for an undetermined observed corner", () => {
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!,
      sceneEvent: {
        kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
        startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000],
      } as const,
      filter: {
        filterVersion: "pipeline-rules-v3", status: "UNDETERMINED",
        reasonCodes: ["EVIDENCE_UNAVAILABLE"], missingFields: [], evidenceIds: [], ruleReferences: [],
      } as const,
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={vi.fn()} />);

    expect(screen.getByText("영상 근거 제공 불가")).toBeInTheDocument();
    expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /코너킥 장면 01/ }).querySelector("img"))
      .toHaveAttribute("src", `/api/analyses/${view.analysisId}/evidence/${candidate.evidence![0]!.evidenceId}`);
    expect(screen.queryByText("영상 근거 없음")).not.toBeInTheDocument();
  });

  it("shows an unavailable thumbnail instead of loading when observed corner evidence is unavailable", () => {
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!,
      evidence: [],
      sceneEvent: {
        kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
        startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000],
      } as const,
      filter: {
        filterVersion: "pipeline-rules-v3", status: "UNDETERMINED",
        reasonCodes: ["EVIDENCE_UNAVAILABLE"], missingFields: [], evidenceIds: [], ruleReferences: [],
      } as const,
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={vi.fn()} />);

    expect(screen.getByText("영상 근거 없음")).toBeInTheDocument();
    expect(screen.queryByText("프레임 준비 중")).not.toBeInTheDocument();
  });

  it("keeps the loading thumbnail for a legacy candidate without a filter", () => {
    const view = analysis(1);
    const candidate = { ...view.candidates[0]!, evidence: [] };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={vi.fn()} />);

    expect(screen.getByText("프레임 준비 중")).toBeInTheDocument();
    expect(screen.getByText("파이프라인 후보")).toBeInTheDocument();
    expect(screen.queryByText("영상 근거 없음")).not.toBeInTheDocument();
  });

  it.each([
    { name: "non-event candidate", cornerObserved: false, status: "UNDETERMINED", reasonCodes: ["EVIDENCE_UNAVAILABLE"], label: "규정 판단 근거 부족" },
    { name: "excluded corner candidate", cornerObserved: true, status: "EXCLUDED", reasonCodes: ["EVIDENCE_UNAVAILABLE"], label: "표시 대상 제외" },
    { name: "corner with another missing reason", cornerObserved: true, status: "UNDETERMINED", reasonCodes: ["RULE_CONTEXT_UNVERIFIED"], label: "규정 판단 근거 부족" },
    { name: "observed corner", cornerObserved: true, status: "OBSERVED", reasonCodes: [], label: "재개 장면 관찰 · 참고 규정" },
  ] as const)("preserves the existing label and loading thumbnail for a $name", ({ cornerObserved, status, reasonCodes, label }) => {
    const view = analysis(1);
    const candidate = {
      ...view.candidates[0]!,
      evidence: [],
      sceneEvent: cornerObserved ? {
        kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
        startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000],
      } as const : null,
      filter: {
        filterVersion: "pipeline-rules-v3", status,
        reasonCodes, missingFields: [], evidenceIds: [], ruleReferences: [],
      },
    };
    render(<SceneList analysisId={view.analysisId} candidates={[candidate]} active={0} onSelect={vi.fn()} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("프레임 준비 중")).toBeInTheDocument();
    expect(screen.queryByText("영상 근거 제공 불가")).not.toBeInTheDocument();
    expect(screen.queryByText("영상 근거 없음")).not.toBeInTheDocument();
  });
});
