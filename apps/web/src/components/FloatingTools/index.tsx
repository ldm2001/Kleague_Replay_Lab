import * as React from "react";

// 빠른 이동 도구
export function FloatingTools() {
  return (
    <aside className="floating-tools" aria-label="빠른 이동">
      <a href="/analyze" aria-label="분석 바로가기">▷</a>
      <a href="#top" aria-label="맨 위로">↑</a>
    </aside>
  );
}
