// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";

// 빠른 이동 도구
export function FloatingTools() {
    // 분석 시작과 상단 이동 링크 구성
    return (
        <aside className="floating-tools" aria-label="빠른 이동">
            {/* 분석 바로가기의 이동 링크 표시 */}
            <a href="/analyze" aria-label="분석 바로가기">▷</a>
            {/* 맨 위로의 이동 링크 표시 */}
            <a href="#top" aria-label="맨 위로">↑</a>
        </aside>
    );
}
