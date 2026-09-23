// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { Reveal } from "../Reveal";

// 분석 시작 유도 화면
// 하단 분석 안내
export function PreFooter() {
    // 하단 분석 유도 영역 구성
    return (
        <section className="pre-footer" aria-labelledby="pre-footer-title">
            {/* 화면 진입 효과 표시 */}
            <Reveal className="pre-footer-copy">
                {/* 분석 안내 문구와 이동 링크 */}
                <p className="pre-footer-label">분석 시작</p>
                {/* 영상 분석 시작을 권하는 구역 제목 표시 */}
                <h2 id="pre-footer-title">영상 속 판정 근거를 확인하세요</h2>
                {/* 분석 시작 안내의 안내 문구 표시 */}
                <p>하이라이트 영상을 올리면 확인이 필요한 장면과 근거를 단계별로 정리합니다</p>
                {/* 영상 분석 시작하기의 이동 링크 표시 */}
                <a href="/analyze">영상 분석 시작하기 <span aria-hidden="true">→</span></a>
            </Reveal>
            {/* 장식 그래픽 영역 */}
            <div className="pre-footer-art" aria-hidden="true"><span /><span /></div>
        </section>
    );
}
