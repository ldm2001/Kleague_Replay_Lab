import * as React from "react";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <span className="site-mark" aria-hidden="true"><span /></span>
        <strong>K LEAGUE Replay Lab</strong>
      </div>
      <p>영상 근거와 공개 규정을 비교하는 판정 보조 시스템</p>
      <small>공식 판정이 아닌 기술적 보조 의견입니다.</small>
    </footer>
  );
}
