import * as React from "react";

const columns = [
  { title: "분석 흐름", links: [["영상 업로드", "/analyze"], ["후보 탐지", "#solutions"], ["규정 대조", "#rules"], ["결과 확인", "/analyze"]] },
  { title: "검토 범위", links: [["파울", "#cases"], ["핸드볼", "#cases"], ["차징과 터치", "#cases"], ["득점 취소", "#cases"]] },
  { title: "이용 안내", links: [["분석 권한", "#top"], ["낮은 확신도", "#rules"], ["영상 한계", "#rules"], ["개인정보 안내", "#top"]] },
] as const;

// 푸터 정보 화면
// 공통 푸터
export function Footer() {
  // 공통 하단 정보 구성
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="site-mark" aria-hidden="true"><span /></span>
          <strong>K LEAGUE Replay Lab</strong>
          <p>영상 근거와 공개 규정을 비교하는 판정 보조 시스템</p>
        </div>
        <nav className="footer-nav" aria-label="푸터 메뉴">
          {/* 푸터 메뉴 열 구성 */}
          {columns.map((column) => <div key={column.title}><h2>{column.title}</h2><ul>{column.links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul></div>)}
        </nav>
      </div>
      <div className="footer-bottom"><small>공식 판정이 아닌 기술적 보조 의견입니다</small><small>© K LEAGUE Replay Lab</small></div>
    </footer>
  );
}
