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
          <p role="status">후보 {state.analysis.candidates.length}건 · 파이프라인 처리 결과</p>
          {state.analysis.filterSummary ? <p>규정 필터 확인 {state.analysis.filterSummary.checkedCount}건 · 근거 부족 {state.analysis.filterSummary.undeterminedCount}건 · 유효하지 않은 구간 제외 {state.analysis.filterSummary.excludedCount}건</p> : null}
          <p>화면 변화로 찾은 후보이며 파울 판정을 의미하지 않습니다</p>
          <SceneView key={analysisId} analysis={state.analysis} />
        </main>
      ) : null}
      <Footer />
    </div>
  );
}
