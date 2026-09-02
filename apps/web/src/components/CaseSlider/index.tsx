"use client";

import * as React from "react";
import { useRef, useState } from "react";

export type CaseItem = Readonly<{
  title: string;
  text: string;
  tone: string;
  image: string;
}>;

type Props = Readonly<{ items: readonly CaseItem[] }>;

// 검토 범위 슬라이더
export function CaseSlider({ items }: Props) {
  // 현재 이동 위치
  const [index, setIndex] = useState(0);
  // 목록 참조
  const list = useRef<HTMLDivElement>(null);

  // 목록 이동
  const move = (direction: -1 | 1) => {
    const next = Math.min(Math.max(index + direction, 0), Math.max(items.length - 1, 0));
    const width = list.current?.firstElementChild?.getBoundingClientRect().width || 320;
    list.current?.scrollBy({ left: direction * (width + 20), behavior: "smooth" });
    setIndex(next);
  };

  // 검토 범위 반환
  return (
    <div className="case-slider">
      <div className="case-slider-controls" aria-label="검토 범위 이동">
        <button type="button" aria-label="이전 검토 범위" onClick={() => move(-1)} disabled={index === 0}>←</button>
        <button type="button" aria-label="다음 검토 범위" onClick={() => move(1)} disabled={index >= items.length - 1}>→</button>
      </div>
      <div className="case-grid" ref={list} role="list">
        {items.map((item) => (
          <article className={`case-card ${item.tone}`} key={item.title} role="listitem">
            <div className="case-art"><img src={item.image} alt={`${item.title} 판정 예시`} loading="lazy" decoding="async" /></div>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <a href="/analyze">분석 흐름 보기 <span aria-hidden="true">→</span></a>
          </article>
        ))}
      </div>
    </div>
  );
}
