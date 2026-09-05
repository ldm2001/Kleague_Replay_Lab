"use client";

import * as React from "react";
import { useState } from "react";

const slides = [
  {
    label: "영상 사실",
    labelEn: "VIDEO FACTS",
    title: "영상 근거 중심의 판정 보조",
    text: "정상 속도와 리플레이와 다른 각도를 구분하고 확인 가능한 장면만 다음 단계로 전달합니다.",
  },
  {
    label: "규정 대조",
    labelEn: "RULE CHECK",
    title: "적용 규정과 판본 확인",
    text: "경기 날짜와 대회에 맞는 판본을 선택하고 적용 조항과 확인되지 않은 조건을 함께 남깁니다.",
  },
  {
    label: "증거 결과",
    labelEn: "EVIDENCE",
    title: "실제 프레임과 증거 클립",
    text: "판정 장면 전후의 프레임과 짧은 영상을 같은 사건으로 묶어 결과에서 바로 확인합니다.",
  },
] as const;

// 솔루션 패널 구성
export function SolutionDeck() {
  // 활성 패널 상태
  const [active, setActive] = useState(0);
  // 현재 솔루션 조회
  const slide = slides[active] ?? slides[0];

  // 솔루션 영역 반환
  return (
    <div className="solution-showcase" data-active={active}>
      <div className="solution-rail" role="tablist" aria-label="주요 솔루션">
        {slides.map((item, index) => (
          <button
            className={index === active ? "is-active" : ""}
            key={item.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls="solution-panel"
            tabIndex={index === active ? 0 : -1}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onKeyDown={(event) => {
              // 방향키 외 입력은 기본 동작 유지
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
              // 탭 이동 기본 동작 차단
              event.preventDefault();
              // 방향에 맞는 다음 패널 계산
              const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % slides.length : (index + slides.length - 1) % slides.length;
              // 다음 패널 활성화
              setActive(next);
              // 다음 탭으로 포커스 이동
              document.querySelector<HTMLButtonElement>(`[aria-controls="solution-panel"][data-index="${next}"]`)?.focus();
            }}
            id={`solution-tab-${index}`}
            data-index={index}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <article className="showcase-feature is-active" id="solution-panel" role="tabpanel" aria-labelledby={`solution-tab-${active}`}>
        <div className="showcase-visual"><div className="visual-grid" /><div className="visual-ball">●</div><div className="visual-line line-one" /><div className="visual-line line-two" /></div>
        <div className="showcase-copy solution-copy" key={slide.label}><p className="label">{slide.labelEn}</p><h3>{slide.title}</h3><p>{slide.text}</p></div>
      </article>
    </div>
  );
}
