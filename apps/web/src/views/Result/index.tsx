"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import type { AnalysisView } from "@replay/application";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { SceneGallery } from "../../components/SceneGallery";

type State =
  | Readonly<{ kind: "LOADING" }>
  | Readonly<{ kind: "READY"; analysis: AnalysisView }>
  | Readonly<{ kind: "ERROR" }>;

export function ResultPage({ analysisId }: Readonly<{ analysisId: string }>) {
  const [state, setState] = useState<State>({ kind: "LOADING" });

  useEffect(() => {
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
          <SceneGallery analysis={state.analysis} />
        </main>
      ) : null}
      <Footer />
    </div>
  );
}
