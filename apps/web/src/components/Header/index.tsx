import * as React from "react";
import { images, path } from "../../assets/image";

export type HeaderMode = "landing" | "analysis";

type Props = Readonly<{ mode: HeaderMode }>;

export function Header({ mode }: Props) {
  const landing = mode === "landing";

  return (
    <header className={landing ? "site-header" : "analysis-topbar"}>
      <a className="site-brand" href={landing ? "#top" : "/"} aria-label="K리그 판정 보조 홈">
        <span className="site-logo-lockup">
          <img
            className="site-logo"
            data-testid="site-logo"
            src={path(landing ? images.brandLight : images.brand)}
            alt="K LEAGUE"
            decoding="async"
          />
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
