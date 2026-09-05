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

export function ResultView({ analysisId, low = true }: Readonly<{ analysisId: string; low?: boolean }>) {
  // 결과 조회 상태 관리
  const [state, setState] = useState<State>({ kind: "LOADING" });
  // 업로드 화면에서 선택한 표시 조건 복원
  const [visible, visibility] = useState(low);

  useEffect(() => {
    // 결과 요청 취소 제어
    const controller = new AbortController();
    void fetch(`/api/analyses/${analysisId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<AnalysisView>;
      })
      .then((analysis) => setState({ kind: "READY", analysis }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "ERROR" });
      });
    return () => controller.abort();
  }, [analysisId]);

  // 평가가 있으면 판정 확신도 사용 · 미평가 장면은 변화 신호 기준
  const candidates = state.kind === "READY" ? state.analysis.candidates.filter((candidate) =>
    visible || (candidate.judgment ? candidate.judgment.confidence !== "LOW" : (candidate.signalScore ?? 0) >= 0.5)
  ) : [];

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
          <label className="confidence-toggle">
            <input type="checkbox" checked={visible} onChange={(event) => visibility(event.target.checked)} />
            <span>낮은 확신도 장면도 표시</span>
          </label>
          {!visible ? <p className="upload-status">미평가 장면은 변화 신호 50% 이상 표시 · 파울 확률과 무관</p> : null}
          {candidates.length === 0 && state.analysis.candidates.length > 0
            ? <p role="status">현재 표시 조건에 맞는 장면이 없습니다 · 낮은 확신도 장면 표시를 켜서 전체 장면을 확인하세요</p>
            : <SceneView key={`${analysisId}:${visible}`} analysis={{ ...state.analysis, candidates }} />}
        </main>
      ) : null}
      <Footer />
    </div>
  );
}
