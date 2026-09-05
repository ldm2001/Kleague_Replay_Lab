import * as React from "react";
import { Reveal } from "../Reveal";

// 분석 시작 유도 화면
// 하단 분석 안내
export function PreFooter() {
  // 하단 분석 유도 영역 구성
  return (
    <section className="pre-footer" aria-labelledby="pre-footer-title">
      <Reveal className="pre-footer-copy">
        {/* 분석 안내 문구와 이동 링크 */}
        <p className="pre-footer-label">분석 시작</p>
        <h2 id="pre-footer-title">영상 속 판정 근거를 확인하세요</h2>
        <p>하이라이트 영상을 올리면 확인이 필요한 장면과 근거를 단계별로 정리합니다</p>
        <a href="/analyze">영상 분석 시작하기 <span aria-hidden="true">→</span></a>
      </Reveal>
      {/* 장식 그래픽 영역 */}
      <div className="pre-footer-art" aria-hidden="true"><span /><span /></div>
    </section>
  );
}
