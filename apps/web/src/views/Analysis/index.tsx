import * as React from "react";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { UploadBox } from "../../components/UploadBox";

export function AnalysisPage() {
  return (
    <div className="analysis-page">
      <Header mode="analysis" />

      <main>
        <section className="upload-section analysis-section" aria-labelledby="upload-title">
          <div className="upload-intro"><p className="label">Start with your footage</p><h1 id="upload-title">분석할 영상을<br /><span>지금 준비하세요</span></h1><p>로그인 없이 같은 브라우저 세션에서 결과를 확인할 수 있습니다.</p></div>
          <UploadBox />
        </section>
      </main>

      <Footer />
    </div>
  );
}
