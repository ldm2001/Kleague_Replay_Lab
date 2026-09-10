"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import type { AnalysisView } from "@replay/application";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { SceneView } from "../../components/SceneView";

type State =
  | Readonly<{ kind: "LOADING" }>
  | Readonly<{ kind: "READY"; analysis: AnalysisView }>
  | Readonly<{ kind: "ERROR" }>;

export function ResultView({ analysisId }: Readonly<{ analysisId: string }>) {
  // 결과 화면은 서버가 계산한 후보와 rules 필터 상태를 재계산하지 않고 표시한다
  // 결과 조회 상태 관리
  const [state, setState] = useState<State>({ kind: "LOADING" });
  const completedOnly = state.kind === "READY" && state.analysis.resultPolicy === "COMPLETED_ONLY";

  useEffect(() => {
    // 분석 식별자에 귀속된 결과만 조회하며 브라우저 상태로 판정 조건을 만들지 않는다
    // 결과 요청 취소 제어
    const controller = new AbortController();
    // 분석 결과 API 요청
    void fetch(`/api/analyses/${analysisId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        // 오류 응답 중단
        if (!response.ok) throw new Error(String(response.status));
        // 결과 본문 변환
        return response.json() as Promise<AnalysisView>;
      })
      .then((analysis) => {
        // 결과 화면 상태 저장
        setState({ kind: "READY", analysis });
      })
      .catch((error: unknown) => {
        // 취소된 요청은 상태 변경 생략
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 조회 실패 상태 저장
        setState({ kind: "ERROR" });
      });
    // 화면 종료 시 요청 취소
    return () => controller.abort();
  }, [analysisId]);

  return (
    <div className="result-page">
      <Header mode="analysis" />
      {state.kind === "LOADING" ? <main className="result-state" aria-busy="true"><p>결과 불러오는 중</p></main> : null}
      {state.kind === "ERROR" ? <main className="result-state"><h1>결과를 불러오지 못했습니다</h1><a href="/analyze">분석 페이지로 이동</a></main> : null}
      {state.kind === "READY" ? (
        <main className="result-main">
          <header className="result-title">
            <div><p>Video review</p><h1>영상 검토 결과</h1></div>
            <a href="/analyze">새 영상 분석</a>
          </header>
          {completedOnly ? <p role="status">{(state.analysis.completedScopeCount ?? 0) > 0 ? `완료된 VAR 범위 분석 ${state.analysis.completedScopeCount}건` : `완료된 분석 결과 ${state.analysis.candidates.length}건`}</p> : <>
            <p role="status">{state.analysis.diagnostics ? `인식된 장면 ${state.analysis.diagnostics.recognizedEventCount}건` : `후보 ${state.analysis.candidates.length}건`} · 파이프라인 처리 결과</p>
            {state.analysis.diagnostics ? <p>현재 코너킥 장면 인식 범위</p> : null}
            {!state.analysis.diagnostics && state.analysis.filterSummary ? <p>규정 필터 확인 {state.analysis.filterSummary.checkedCount}건 · 재개 장면 관찰 {state.analysis.filterSummary.observedCount ?? 0}건 · 검토 규정 연결 {state.analysis.filterSummary.applicableCount ?? 0}건 · 근거 부족 {state.analysis.filterSummary.undeterminedCount}건 · 유효하지 않은 구간 제외 {state.analysis.filterSummary.excludedCount}건</p> : null}
            <p>영상에서 추출한 장면과 규정 검토 조건입니다. 장면 인식은 규정 준수나 파울 판정을 의미하지 않습니다</p>
          </>}
          <SceneView key={analysisId} analysis={state.analysis} />
          {!completedOnly && state.analysis.diagnostics ? <section aria-label="처리 진단">
            <h2>처리 진단</h2>
            <p>사건 종류를 인식하지 못한 내부 후보 {state.analysis.diagnostics.rawProposalCount}건</p>
            <p>유효하지 않은 처리 결과 {state.analysis.diagnostics.invalidOutputCount}건</p>
            <p>내부 후보는 사건 종류가 확인되지 않은 처리 기록이며 정상 플레이나 파울 없음 판정이 아닙니다</p>
          </section> : null}
        </main>
      ) : null}
      <Footer />
    </div>
  );
}
