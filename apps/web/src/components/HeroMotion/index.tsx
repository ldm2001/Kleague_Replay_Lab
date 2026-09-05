"use client";

import * as React from "react";
import { useEffect, useRef } from "react";

type Props = React.PropsWithChildren<React.ComponentPropsWithoutRef<"section">>;

// 스크롤 상태 연결
export function HeroMotion({ children, className, ...props }: Props) {
  // 영웅 영역 참조
  const element = useRef<HTMLElement>(null);

  // 수동 스크롤 감지
  useEffect(() => {
    // 영웅 영역 스크롤 대상 확인
    const target = element.current;
    if (!target) return;
    // 예약된 화면 갱신 식별자
    let frame = 0;
    // 영웅 영역의 스크롤 상태 반영
    const render = () => {
      frame = 0;
      target.dataset.scrolled = String(globalThis.scrollY > 1);
    };
    // 스크롤 이벤트를 다음 프레임으로 묶기
    const scroll = () => {
      if (frame === 0) frame = globalThis.requestAnimationFrame(render);
    };
    render();
    globalThis.addEventListener("scroll", scroll, { passive: true });
    // 스크롤 이벤트 정리
    return () => {
      globalThis.removeEventListener("scroll", scroll);
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
    };
  }, []);

  // 영웅 영역 반환
  return <section ref={element} className={className ? `hero ${className}` : "hero"} {...props}>{children}</section>;
}
