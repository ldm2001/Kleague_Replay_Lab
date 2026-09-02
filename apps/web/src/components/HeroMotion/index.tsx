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
    const target = element.current;
    if (!target) return;
    let frame = 0;
    const render = () => {
      frame = 0;
      target.dataset.scrolled = String(globalThis.scrollY > 1);
    };
    const scroll = () => {
      if (frame === 0) frame = globalThis.requestAnimationFrame(render);
    };
    render();
    globalThis.addEventListener("scroll", scroll, { passive: true });
    return () => {
      globalThis.removeEventListener("scroll", scroll);
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
    };
  }, []);

  // 영웅 영역 반환
  return <section ref={element} className={className ? `hero ${className}` : "hero"} {...props}>{children}</section>;
}
