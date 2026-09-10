// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateVarScope, pipelineFilter } from "@replay/rule-engine";
import { competitionRules, ruleSet } from "@replay/rule-data";
import { knownVideoSource } from "../../adapters/known-video-sources";
import { analysis, candidate, judgment } from "../../../test/fixtures/result";
import { RulePanel } from "./index";

describe("RulePanel", () => {
  afterEach(() => {
    // 테스트 DOM 정리
    cleanup();
  });

  it("shows a pending state without inventing a decision", () => {
    // 사실 대기 후보 렌더링
    render(<RulePanel analysis={analysis()} candidate={candidate(0)} />);
    expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
    expect(screen.queryByText(/확인하면/)).not.toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
  });

  it("separates facts IFAB K League and VAR evidence", () => {
    // 판정이 있는 후보 렌더링
    render(<RulePanel analysis={analysis()} candidate={candidate(1, judgment)} />);
    expect(screen.getByRole("region", { name: "확인된 사실" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "IFAB 규정" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "K리그 대회요강" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "VAR 검토" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "관측 판정 비교" })).toHaveTextContent("재개와 카드 비교");
  });

  it("displays the server filter instead of legacy model or user judgments", () => {
    render(<RulePanel analysis={analysis()} candidate={{ ...candidate(1, judgment), filter: {
      filterVersion: "pipeline-rules-v1", status: "UNDETERMINED",
      reasonCodes: ["RULE_CONTEXT_UNVERIFIED", "CONTACT_UNOBSERVED"],
      missingFields: ["contact"], ruleReferences: [], evidenceIds: [],
    } }} />);
    expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
    expect(screen.getByText("경기와 적용 규정 판본이 확인되지 않았습니다")).toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("prioritizes a completed competition VAR scope over unknown foul conditions and saved judgments", () => {
    const source = knownVideoSource("2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857")!;
    // 테스트용 GOAL cue를 실제 엔진에 전달한 UI fixture이며 실제 영상 검출을 증명하지 않는다
    const scope = evaluateVarScope({
      source, startMs: 0, endMs: 2000,
      broadcastCue: { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000, endMs: 1400, evidenceTimestampsMs: [1000, 1200, 1400] },
      evidence: [{ evidenceId: "scope-clip", kind: "CLIP", startMs: 0, endMs: 2000 }],
    }, competitionRules(source.competition, source.season))!;
    expect(scope.status).toBe("COMPLETED");
    render(<RulePanel analysis={analysis()} candidate={{ ...candidate(0, judgment), varScopeEvaluation: scope, filter: {
      filterVersion: "pipeline-rules-v3", status: "UNDETERMINED",
      reasonCodes: ["RULE_CONTEXT_UNVERIFIED", "CONTACT_UNOBSERVED"],
      missingFields: ["contact"], ruleReferences: [], evidenceIds: [],
    } }} />);

    expect(screen.getByRole("heading", { name: "득점 관련 VAR 검토 범위" })).toBeInTheDocument();
    expect(screen.getByText("대회요강의 적용 범주에 해당")).toBeInTheDocument();
    expect(screen.getByText(scope.question)).toBeInTheDocument();
    expect(screen.getByText(scope.explanation)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "범위 평가 결과" })).toHaveTextContent(scope.explanation);
    expect(screen.getByText(`${scope.competition} ${scope.season} · 대회요강`)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "분석 근거" })).toHaveTextContent("중계의 GOAL 표시");
    const citations = screen.getByRole("region", { name: "K리그 대회요강" });
    for (const citation of scope.citations) {
      expect(citations).toHaveTextContent(`${citation.law} ${citation.section}`);
      expect(citations).toHaveTextContent(citation.quoteSnapshot);
      expect(citations.querySelector(`a[href='${citation.sourceUrl}']`)).not.toBeNull();
    }
    expect(screen.getByText("제공된 대회요강의 적용 범주 분석이며 실제 득점 인정·VAR 실시·원심 오류·개입 필요성을 뜻하지 않습니다")).toBeInTheDocument();
    expect(screen.queryByText(/규정 판단 근거 부족|조건 미확인|파울 가능성 있음|규정 판본 미확인/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "IFAB 규정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "확인된 사실" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "VAR 검토" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("긴 인용을 접어서 핵심 조항을 먼저 표시", () => {
    // 핵심 세 건 이후 인용은 펼쳐보기로 제공
    const citations = Array.from({ length: 6 }, (_, index) => ({ ...judgment.citations[0]!, ruleId: `ifab-${index}`, section: String(index + 1) }));
    const { container } = render(<RulePanel analysis={analysis()} candidate={candidate(1, { ...judgment, citations })} />);
    expect(screen.getByText("추가 조항 3개")).toBeInTheDocument();
    expect(container.querySelector(".citation-more")).not.toHaveAttribute("open");
    expect(container.querySelector("section[aria-label='IFAB 규정'] > .citation-list")?.children).toHaveLength(3);
  });

  it.each([null, "ifab-2026-27"])("shows the observed corner and unverified conditions for context %s", (versionId) => {
    const sceneEvent = {
      kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
      startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000, 1500],
    } as const;
    const scene = candidate(0, judgment);
    const filter = pipelineFilter({ ...scene, sceneEvent, category: "OTHER", evidenceIds: ["corner-frame"] }, versionId ? ruleSet(versionId) : null);
    render(<RulePanel analysis={analysis()} candidate={{ ...scene, sceneEvent, filter }} />);
    expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "코너킥 검토 조건" })).toHaveTextContent("직접 공을 받은 경우");
    expect(screen.getAllByText(/조건 미확인/)).toHaveLength(4);
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    if (versionId) {
      expect(screen.getByText("검증된 적용 판본 · 검토 규정")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "검토 기준 조항" })).toHaveTextContent("17 1");
      expect(screen.getAllByRole("link", { name: "적용 판본 원문 보기" })[0]).toHaveAttribute("href", expect.stringContaining("202627"));
    } else {
      expect(screen.getByText("적용 판본 미확정 · 참고 규정")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "검토 기준 조항" })).not.toBeInTheDocument();
    }
  });

  it("keeps a recognized corner visible when its video evidence is unavailable", () => {
    const sceneEvent = {
      kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
      startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000, 1500],
    } as const;
    const scene = { ...candidate(0, judgment), sceneEvent, evidence: [] };
    const filter = pipelineFilter({ ...scene, category: "OTHER", evidenceIds: [] }, null);
    const result = { ...analysis(), diagnostics: {
      rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 1,
      supportedEventTypes: ["CORNER_KICK"] as const, reasons: ["EVIDENCE_UNAVAILABLE"],
    } };
    render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
    expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
    expect(screen.getByText("영상 근거 제공 불가")).toBeInTheDocument();
    expect(screen.getByText("이 장면의 영상 근거를 제공할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/IFAB 규정 조건의 충족 여부는 확인되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText("경기와 적용 규정 판본이 확인되지 않았습니다")).toBeInTheDocument();
    expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
    expect(screen.queryByText("판정 보류")).not.toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByText("파울 근거 없음")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "코너킥 검토 조건" })).not.toBeInTheDocument();
    expect(filter.status).toBe("UNDETERMINED");
    expect(filter.reasonCodes).toContain("EVIDENCE_UNAVAILABLE");
  });

  it("preserves unverified law conditions supplied with a corner lacking video evidence", () => {
    const sceneEvent = {
      kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
      startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000, 1500],
    } as const;
    const scene = { ...candidate(0), sceneEvent, evidence: [] };
    const cornerFilter = pipelineFilter({ ...scene, category: "OTHER", evidenceIds: ["corner-frame"] }, ruleSet("ifab-2026-27"));
    const filter = {
      ...cornerFilter, status: "UNDETERMINED" as const, reasonCodes: ["EVIDENCE_UNAVAILABLE"] as const, evidenceIds: [],
    };
    const result = { ...analysis(), diagnostics: {
      rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 1,
      supportedEventTypes: ["CORNER_KICK"] as const, reasons: ["EVIDENCE_UNAVAILABLE"],
    } };
    render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
    expect(screen.getByRole("region", { name: "코너킥 검토 조건" })).toHaveTextContent("직접 공을 받은 경우");
    expect(screen.getAllByText(/조건 미확인/)).toHaveLength(4);
    expect(screen.getByRole("region", { name: "검토 기준 조항" })).toHaveTextContent("17 1");
    expect(filter.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(true);
    expect(filter.status).toBe("UNDETERMINED");
  });

  it("does not identify a corner from missing evidence without a valid scene event", () => {
    const scene = { ...candidate(0), evidence: [] };
    const filter = pipelineFilter({ ...scene, category: "CORNER_KICK", evidenceIds: [] }, null);
    const result = { ...analysis(), diagnostics: {
      rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 0,
      supportedEventTypes: ["CORNER_KICK"] as const, reasons: ["SCENE_EVENT_UNAVAILABLE"],
    } };
    render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
    expect(screen.getByRole("heading", { name: "규정 판단 근거 부족" })).toBeInTheDocument();
    expect(screen.getByText("세트피스의 시간대별 관찰 근거가 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "코너킥 장면" })).not.toBeInTheDocument();
  });

  it("preserves the legacy missing-evidence result when diagnostics are absent", () => {
    const sceneEvent = {
      kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
      startMs: 0, endMs: 2000, restartMs: 1000, evidenceTimestampsMs: [0, 1000, 1500],
    } as const;
    const scene = { ...candidate(0), sceneEvent, evidence: [] };
    const filter = pipelineFilter({ ...scene, category: "OTHER", evidenceIds: [] }, null);
    render(<RulePanel analysis={analysis()} candidate={{ ...scene, filter }} />);
    expect(screen.getByRole("heading", { name: "규정 판단 근거 부족" })).toBeInTheDocument();
    expect(screen.getByText("이 장면의 영상 근거를 제공할 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "코너킥 장면" })).not.toBeInTheDocument();
    expect(screen.queryByText("영상 근거 제공 불가")).not.toBeInTheDocument();
  });
});
