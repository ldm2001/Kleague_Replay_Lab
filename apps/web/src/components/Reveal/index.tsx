"use client";

import * as React from "react";
import { useEffect, useRef } from "react";

type Props = Readonly<{
  as?: "article" | "div" | "section";
  children: React.ReactNode;
  className?: string;
  delay?: number;
}>;

// 화면 진입 감지
export function Reveal({ as: Tag = "div", children, className = "", delay = 0 }: Props) {
  // 관찰 대상 참조
  const element = useRef<HTMLElement>(null);

  // 화면 진입 효과 연결
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || !("IntersectionObserver" in globalThis)) {
      target.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      target.classList.add("is-visible");
      observer.unobserve(target);
    }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // 진입 지연 스타일
  const style = { "--reveal-delay": `${delay}ms` } as React.CSSProperties;

  // 효과 대상 반환
  return React.createElement(Tag, {
    ref: element as unknown as React.Ref<HTMLDivElement>,
    className: `reveal ${className}`.trim(),
    style,
  }, children);
}
