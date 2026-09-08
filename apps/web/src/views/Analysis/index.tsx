"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { MediaView } from "@replay/application";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { UploadPanel } from "../../components/UploadPanel";

// 분석 화면 구성
export function AnalysisView() {
  // 이 화면은 영상 제출만 담당하고 실제 후보와 필터 결과는 결과 화면에서 읽는다
  // 결과 이동 라우터
  const router = useRouter();
  // 분석 완료 결과 이동
  const result = useCallback((view: MediaView | null) => {
    // 업로드 결과 분석 읽기
    const analysis = view?.analysis;
    // 분석 결과 없는 상태 종료
    if (!analysis) return;
    // 서버 파이프라인이 끝나면 사용자 설정 없이 결과 화면으로 이동
    if (analysis.status === "CANDIDATES_READY" || analysis.status === "COMPLETED") {
      router.push(`/results/${analysis.analysisId}`);
    }
  }, [router]);
  // 분석 화면 반환
  return (
    <div className="analysis-page">
      <Header mode="analysis" />

      <main>
        <section className="upload-section analysis-section" aria-labelledby="upload-title">
          {/* 분석 안내와 파일 선택 영역 */}
          <div className="upload-intro"><p className="label">Start with your footage</p><h1 id="upload-title">분석할 영상을<br /><span>지금 준비하세요</span></h1><p>로그인 없이 현재 화면에서 결과를 확인할 수 있습니다.</p></div>
          {/* 파일 선택과 분석 시작 영역 */}
          <UploadPanel onView={result} />
        </section>
      </main>

      <Footer />
    </div>
  );
}
