import * as React from "react";
import { images, path } from "../assets";
import { UploadBox } from "./upload-box";

export function AnalysisPage() {
  return (
    <div className="analysis-page">
      <header className="analysis-topbar">
        <a className="site-brand" href="/" aria-label="K리그 판정 보조 홈">
          <span className="site-logo-lockup"><img className="site-logo" data-testid="site-logo" src={path(images.brand)} alt="K LEAGUE" decoding="async" /><small>Replay Lab</small></span>
        </a>
        <a className="analysis-back" href="/">홈으로 돌아가기 <span aria-hidden="true">↖</span></a>
      </header>

      <main>
        <section className="upload-section analysis-section" aria-labelledby="upload-title">
          <div className="upload-intro"><p className="label">Start with your footage</p><h1 id="upload-title">분석할 영상을<br /><span>지금 준비하세요</span></h1><p>로그인 없이 같은 브라우저 세션에서 결과를 확인할 수 있습니다.</p></div>
          <UploadBox />
        </section>
      </main>

      <footer className="site-footer"><div className="footer-brand"><span className="site-mark" aria-hidden="true"><span /></span><strong>K LEAGUE Replay Lab</strong></div><p>영상 근거와 공개 규정을 비교하는 판정 보조 시스템</p><small>공식 판정이 아닌 기술적 보조 의견입니다.</small></footer>
    </div>
  );
}
