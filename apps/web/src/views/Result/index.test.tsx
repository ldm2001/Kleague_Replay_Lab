// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "@replay/application";
import { competitionRules } from "@replay/rule-data";
import { evaluateVarScope } from "@replay/rule-engine";
import { VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";
import { knownVideoSource } from "../../adapters/known-video-sources";
import { analysis as resultFixture } from "../../../test/fixtures/result";
import { ResultView } from "./index";

const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const view = resultFixture();

// 결과 화면 테스트
describe("ResultView", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // 요청 분석 조회 확인
  it("loads the requested analysis instead of the latest analysis", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }));
    render(<ResultView analysisId={ANALYSIS} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "영상 검토 결과" })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(`/api/analyses/${ANALYSIS}`, expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute("href", "/analyze");
    expect(screen.getByLabelText("장면 캐러셀")).toBeInTheDocument();
  });

  // 결과 오류 화면 확인
  it("shows a scoped error state when the result cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ kind: "NOT_FOUND" }), { status: 404 }));
    render(<ResultView analysisId={ANALYSIS} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "결과를 불러오지 못했습니다" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "분석 페이지로 이동" })).toHaveAttribute("href", "/analyze");
  });

  it("shows results without configuration or fact entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(view)));
    render(<ResultView analysisId={ANALYSIS} />);
    await waitFor(() => expect(screen.getByText("01 / 03")).toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/아래에서 장면의 접촉/)).not.toBeInTheDocument();
  });

  it("shows the server's observed and applicable counts without recalculating them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...view,
      filterSummary: { checkedCount: 3, observedCount: 1, applicableCount: 1, undeterminedCount: 1, excludedCount: 0 },
    })));
    render(<ResultView analysisId={ANALYSIS} />);
    await waitFor(() => expect(screen.getByText(/재개 장면 관찰 1건 · 검토 규정 연결 1건/)).toBeInTheDocument());
    expect(screen.getByText(/영상에서 추출한 장면과 규정 검토 조건입니다/)).toBeInTheDocument();
    expect(screen.queryByText(/화면 변화로 찾은 후보이며/)).not.toBeInTheDocument();
  });

  it("keeps older results readable when the new summary counts are absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...view, filterSummary: { checkedCount: 3, undeterminedCount: 3, excludedCount: 0 },
    })));
    render(<ResultView analysisId={ANALYSIS} />);
    await waitFor(() => expect(screen.getByText(/재개 장면 관찰 0건 · 검토 규정 연결 0건/)).toBeInTheDocument());
  });

  it("separates recognized scenes from internal proposals and technical diagnostics", async () => {
    const scoped = {
      ...view,
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 1, recognizedEventCount: 2, supportedEventTypes: ["CORNER_KICK"], reasons: ["INCIDENT_UNCLASSIFIED"] },
      filterSummary: { checkedCount: 42, observedCount: 2, applicableCount: 0, undeterminedCount: 39, excludedCount: 1 },
      candidates: view.candidates.slice(0, 2).map((candidate) => ({
        ...candidate, judgment: null,
        sceneEvent: { kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1", startMs: candidate.startMs, endMs: candidate.endMs, restartMs: candidate.anchorMs!, evidenceTimestampsMs: [candidate.startMs, candidate.anchorMs!] } as const,
        filter: { filterVersion: "pipeline-rules-v3", status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true, reasonCodes: ["SITUATION_OBSERVED"], missingFields: [], ruleReferences: [], evidenceIds: [] } as const,
      })),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(scoped)));
    render(<ResultView analysisId={ANALYSIS} />);

    await screen.findByText("인식된 장면 2건 · 파이프라인 처리 결과");
    expect(screen.getByText("현재 코너킥 장면 인식 범위")).toBeInTheDocument();
    const diagnostics = screen.getByRole("region", { name: "처리 진단" });
    expect(within(diagnostics).getByText("사건 종류를 인식하지 못한 내부 후보 39건")).toBeInTheDocument();
    expect(within(diagnostics).getByText("유효하지 않은 처리 결과 1건")).toBeInTheDocument();
    expect(screen.queryByText(/근거 부족 39건|판단 보류 39건|규정 필터 확인 42건/)).not.toBeInTheDocument();
    expect(screen.queryByText(/정상 플레이 39건|파울 없음 39건/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^코너킥 장면/ })).toHaveLength(2);
    expect(screen.getByText(/장면 인식은 규정 준수나 파울 판정을 의미하지 않습니다/)).toBeInTheDocument();
  });

  it("states the corner recognition limit when only unclassified internal proposals remain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...view, candidates: [],
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 0, recognizedEventCount: 0, supportedEventTypes: ["CORNER_KICK"], reasons: ["INCIDENT_UNCLASSIFIED"] },
      filterSummary: { checkedCount: 39, observedCount: 0, applicableCount: 0, undeterminedCount: 39, excludedCount: 0 },
    })));
    render(<ResultView analysisId={ANALYSIS} />);

    await screen.findByText("인식된 장면 0건 · 파이프라인 처리 결과");
    expect(screen.getByRole("heading", { name: "인식된 코너킥 장면이 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("현재 코너킥 장면 인식 범위")).toBeInTheDocument();
    expect(screen.getByText("사건 종류를 인식하지 못한 내부 후보 39건")).toBeInTheDocument();
    expect(screen.getByText(/다른 사건이나 파울이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
    expect(screen.queryByText(/근거 부족 39건|판단 보류 39건/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^후보 장면/ })).not.toBeInTheDocument();
  });

  it("shows only the completed result count and empty state under the completed-only policy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...view, resultPolicy: "COMPLETED_ONLY", candidates: [], evaluatedCount: 0, judgmentStatus: "NOT_EVALUATED",
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 1, recognizedEventCount: 2, supportedEventTypes: ["CORNER_KICK"], reasons: ["INCIDENT_UNCLASSIFIED"] },
      filterSummary: { checkedCount: 42, observedCount: 2, applicableCount: 0, undeterminedCount: 39, excludedCount: 1 },
    })));
    render(<ResultView analysisId={ANALYSIS} />);

    await screen.findByText("완료된 분석 결과 0건");
    expect(screen.getByRole("heading", { name: "완료된 분석 결과가 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("이번 영상에서 규정 평가를 완료한 장면이 없습니다. 파울이 없다는 판정은 아닙니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute("href", "/analyze");
    expect(screen.queryByRole("region", { name: "장면 캐러셀" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
    expect(screen.queryByText(/인식된 장면|코너킥 장면 인식 범위|내부 후보|규정 필터 확인|규정 검토 조건|조건 미확인|판단 보류/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /장면/ })).not.toBeInTheDocument();
  });

  it("displays the server's completed VAR scope count without treating it as a foul decision count", async () => {
    const source = knownVideoSource("2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857")!;
    // 테스트용 cue와 실제 규정 엔진으로 화면 계약만 검증하며 실제 영상 분석 결과를 가장하지 않는다
    const scope = evaluateVarScope({
      source, startMs: 0, endMs: 2000,
      broadcastCue: { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000, endMs: 1400, evidenceTimestampsMs: [1000, 1200, 1400] },
      evidence: [{ evidenceId: "scope-clip", kind: "CLIP", startMs: 0, endMs: 2000 }],
    }, competitionRules(source.competition, source.season))!;
    expect(scope.status).toBe("COMPLETED");
    const result: AnalysisView = {
      ...view, resultPolicy: "COMPLETED_ONLY", completedScopeCount: 7, evaluatedCount: 0, judgmentStatus: "NOT_EVALUATED",
      candidates: [{ ...view.candidates[0]!, judgment: null, varScopeEvaluation: scope }],
      diagnostics: { rawProposalCount: 39, invalidOutputCount: 1, recognizedEventCount: 2, supportedEventTypes: ["GOAL_GRAPHIC"], reasons: [] },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(result)));
    render(<ResultView analysisId={ANALYSIS} />);

    await screen.findByText("완료된 VAR 범위 분석 7건");
    expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
    expect(screen.queryByText(/파울 가능성 있음|완료된 분석 결과 1건|인식된 장면|내부 후보/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([undefined, "COMPLETED_ONLY"])("does not present a failed analysis as an empty successful result (%s)", async (resultPolicy) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ...view, resultPolicy, candidates: [], evaluatedCount: 0, judgmentStatus: "NOT_EVALUATED",
      status: "FAILED", stage: "FAILED", failureCode: "WORKER_ERROR",
    })));
    render(<ResultView analysisId={ANALYSIS} />);

    await screen.findByRole("heading", { name: "영상 처리를 완료하지 못했습니다" });
    expect(screen.queryByRole("heading", { name: "완료된 분석 결과가 없습니다" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "탐지된 주요 장면이 없습니다" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute("href", "/analyze");
  });

  // 실제 Worker → API → DB → rules 결과를 그대로 렌더링하며 영상 디코딩이나 브라우저 검증은 포함하지 않는다
  it.skipIf(!process.env.REPLAY_FRONTEND_RESULT)("renders the real pipeline result according to its result policy", async () => {
    const actual = JSON.parse(readFileSync(process.env.REPLAY_FRONTEND_RESULT!, "utf8")) as AnalysisView;
    if (actual.resultPolicy === "COMPLETED_ONLY" && (actual.completedScopeCount ?? 0) > 0) {
      expect(actual.candidates.length).toBeGreaterThanOrEqual(1);
      expect(actual.completedScopeCount).toBe(actual.candidates.length);
      expect(actual.evaluatedCount).toBe(0);
      expect(actual.judgmentStatus).toBe("NOT_EVALUATED");
      expect(actual).not.toHaveProperty("diagnostics");
      expect(actual).not.toHaveProperty("filterSummary");
      for (const candidate of actual.candidates) {
        const scope = candidate.varScopeEvaluation!;
        expect(scope).toMatchObject({
          kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED", included: true,
          provenance: { origin: "VIDEO_CUE_AND_COMPETITION_RULES", evaluatorVersion: "competition-var-scope-v1", cueMethod: "broadcast-goal-glyphs-v1" },
        });
        const source = knownVideoSource(scope.provenance.sourceSha256);
        expect(source).not.toBeNull();
        const book = competitionRules(source!.competition, source!.season)!;
        expect(scope).toMatchObject({ competition: source!.competition, season: source!.season, ruleVersionId: book.versionId });
        expect(scope.provenance).toMatchObject({ matchKey: source!.matchKey, ruleDocumentSha256: book.source.documentSha256 });
        expect(scope.notAssessed).toEqual(VAR_SCOPE_NOT_ASSESSED);
        expect(scope.citations.length).toBeGreaterThan(0);
        for (const citation of scope.citations) {
          expect(citation).toMatchObject({ authority: "KLEAGUE", edition: source!.season });
          expect(citation.ruleId.startsWith(`${book.versionId}-`)).toBe(true);
        }
        expect(scope.evidenceIds.length).toBeGreaterThan(0);
        expect(scope.evidenceIds.every((id) => candidate.evidence?.some((item) => item.evidenceId === id && item.kind === "CLIP"))).toBe(true);
        expect(candidate.judgment).toBeNull();
        expect(scope).not.toHaveProperty("decision");
        expect(scope).not.toHaveProperty("intervention");
      }
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(actual)));
      render(<ResultView analysisId={actual.analysisId} />);
      await screen.findByText(`완료된 VAR 범위 분석 ${actual.completedScopeCount}건`);
      const sceneButtons = screen.getAllByRole("button", { name: /^득점 관련 장면/ });
      expect(sceneButtons).toHaveLength(actual.candidates.length);
      expect(sceneButtons[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "득점 관련 VAR 검토 범위" })).toBeInTheDocument();
      expect(screen.getByText("대회요강의 적용 범주에 해당")).toBeInTheDocument();
      const firstScope = actual.candidates[0]!.varScopeEvaluation!;
      expect(screen.getByText(firstScope.explanation)).toBeInTheDocument();
      const citations = screen.getByRole("region", { name: "K리그 대회요강" });
      for (const citation of firstScope.citations) {
        expect(citations).toHaveTextContent(citation.quoteSnapshot);
        expect(citations.querySelector(`a[href='${citation.sourceUrl}']`)).not.toBeNull();
      }
      expect(screen.getByText("제공된 대회요강의 적용 범주 분석이며 실제 득점 인정·VAR 실시·원심 오류·개입 필요성을 뜻하지 않습니다")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "VAR 검토" })).not.toBeInTheDocument();
      expect(screen.queryByText(/UNVERIFIED|조건 미확인|판단 보류|판정 보류|규정 판단 근거 부족|파울 가능성 있음|VAR 검토를 실시했습니다|VAR이 실시됐습니다/)).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      // 마지막 득점 관련 연속 장면을 선택하고 서버가 연결한 실제 클립 주소를 유지한다
      fireEvent.click(sceneButtons[sceneButtons.length - 1]!);
      expect(sceneButtons[sceneButtons.length - 1]).toHaveAttribute("aria-current", "true");
      const lastCandidate = actual.candidates[actual.candidates.length - 1]!;
      const lastClip = lastCandidate.evidence?.find((item) => item.kind === "CLIP");
      expect(lastClip).toBeDefined();
      expect(screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")).toHaveAttribute("src", `/api/analyses/${actual.analysisId}/evidence/${lastClip!.evidenceId}`);
      expect(screen.getByText(lastCandidate.varScopeEvaluation!.explanation)).toBeInTheDocument();
      return;
    }
    if (actual.resultPolicy === "COMPLETED_ONLY") {
      expect(actual.candidates).toEqual([]);
      expect(actual.evaluatedCount).toBe(0);
      expect(actual.judgmentStatus).toBe("NOT_EVALUATED");
      expect(actual).not.toHaveProperty("diagnostics");
      expect(actual).not.toHaveProperty("filterSummary");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(actual)));
      render(<ResultView analysisId={actual.analysisId} />);
      await screen.findByText("완료된 분석 결과 0건");
      expect(screen.getByRole("heading", { name: "완료된 분석 결과가 없습니다" })).toBeInTheDocument();
      expect(screen.getByText(/파울이 없다는 판정은 아닙니다/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute("href", "/analyze");
      expect(screen.queryByRole("button", { name: /장면/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "장면 캐러셀" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
      expect(screen.queryByText(/인식된 장면|인식 범위|내부 후보|조건 미확인|판단 보류|판정 보류/)).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      return;
    }
    const cornerIndex = actual.candidates.findIndex((candidate) => candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED");
    expect(cornerIndex).toBeGreaterThanOrEqual(0);
    const corner = actual.candidates[cornerIndex]!;
    const clip = corner.evidence?.find((item) => item.kind === "CLIP");
    expect(clip).toBeDefined();
    expect(corner.filter).toMatchObject({ status: "OBSERVED", referenceOnly: true });
    expect(corner.filter?.conditions).toHaveLength(4);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(actual)));
    render(<ResultView analysisId={actual.analysisId} />);
    const cornerButton = await screen.findByRole("button", { name: new RegExp(`^코너킥 장면 ${String(cornerIndex + 1).padStart(2, "0")} `) });
    // 결과 진입만으로 인식된 장면과 규정 조건이 처음부터 보인다
    expect(cornerButton).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
    expect(screen.getByText("적용 판본 미확정 · 참고 규정")).toBeInTheDocument();
    const conditions = screen.getByRole("region", { name: "코너킥 검토 조건" });
    expect(within(conditions).getAllByText(/조건 미확인/)).toHaveLength(4);
    for (const condition of corner.filter!.conditions!) expect(within(conditions).getByText(condition.description)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")).toHaveAttribute("src", `/api/analyses/${actual.analysisId}/evidence/${clip!.evidenceId}`);
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    if (actual.diagnostics) {
      expect(actual.diagnostics.recognizedEventCount).toBe(actual.candidates.length);
      expect(actual.candidates.every((candidate) => candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED")).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent(`인식된 장면 ${actual.diagnostics.recognizedEventCount}건`);
      expect(screen.getByRole("region", { name: "처리 진단" })).toHaveTextContent(`사건 종류를 인식하지 못한 내부 후보 ${actual.diagnostics.rawProposalCount}건`);
      expect(screen.queryByText(/근거 부족 \d+건|판단 보류 \d+건|규정 필터 확인 \d+건/)).not.toBeInTheDocument();
    }
    if (actual.candidates.length > 1) {
      fireEvent.click(screen.getByRole("button", { name: cornerIndex > 0 ? "이전 장면" : "다음 장면" }));
      expect(cornerButton).not.toHaveAttribute("aria-current", "true");
      fireEvent.click(cornerButton);
      expect(cornerButton).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")).toHaveAttribute("src", `/api/analyses/${actual.analysisId}/evidence/${clip!.evidenceId}`);
    }
  });
});
