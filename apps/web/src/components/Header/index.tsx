"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import { images, path } from "../../assets/image";

export type HeaderMode = "landing" | "analysis";

type Props = Readonly<{ mode: HeaderMode }>;

// 화면 종류별 헤더
export function Header({ mode }: Props) {
  // 랜딩 모드 확인
  const landing = mode === "landing";
  // 헤더 참조
  const header = useRef<HTMLElement>(null);

  // 스크롤 상태 연결
  useEffect(() => {
    if (!landing) return;
    let frame = 0;
    const render = () => {
      frame = 0;
      if (header.current) header.current.dataset.scrolled = String(globalThis.scrollY > 1);
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
  }, [landing]);

  // 헤더 화면 구성
  return (
    <header ref={header} className={landing ? "site-header" : "analysis-topbar"} data-scrolled="false">
      <a className="site-brand" href={landing ? "#top" : "/"} aria-label="K리그 판정 보조 홈">
        <span className="site-logo-lockup">
          {landing ? <>
            <img className="site-logo site-logo-light" data-testid="site-logo" src={path(images.brandLight)} alt="K LEAGUE" decoding="async" />
            <img className="site-logo site-logo-dark" src={path(images.brand)} alt="" aria-hidden="true" decoding="async" />
          </> : <img className="site-logo" data-testid="site-logo" src={path(images.brand)} alt="K LEAGUE" decoding="async" />}
          <small>Replay Lab</small>
        </span>
      </a>

      {landing ? (
        <nav className="site-nav" aria-label="주요 메뉴">
          <a href="#solutions">솔루션</a>
          <a href="#services">분석 기능</a>
          <a href="#rules">규정</a>
          <a href="#cases">검토 범위</a>
        </nav>
      ) : (
        <a className="analysis-back" href="/">
          랜딩으로 돌아가기 <span aria-hidden="true">↖</span>
        </a>
      )}
    </header>
  );
}
