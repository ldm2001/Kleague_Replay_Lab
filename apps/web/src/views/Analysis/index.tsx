"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { MediaView } from "@replay/application";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { UploadBox } from "../../components/UploadBox";

// 분석 화면 구성
export function AnalysisPage() {
  const router = useRouter();
  const result = useCallback((view: MediaView | null) => {
    const analysis = view?.analysis;
    if (!analysis) return;
    if (analysis.status === "CANDIDATES_READY" || analysis.status === "COMPLETED") {
      router.push(`/results/${analysis.analysisId}`);
    }
  }, [router]);
  // 분석 전체 화면 반환
  return (
    <div className="analysis-page">
      <Header mode="analysis" />

      <main>
        <section className="upload-section analysis-section" aria-labelledby="upload-title">
          <div className="upload-intro"><p className="label">Start with your footage</p><h1 id="upload-title">분석할 영상을<br /><span>지금 준비하세요</span></h1><p>로그인 없이 현재 화면에서 결과를 확인할 수 있습니다.</p></div>
          <UploadBox onView={result} />
        </section>
      </main>

      <Footer />
    </div>
  );
}
