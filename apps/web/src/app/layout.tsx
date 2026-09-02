import type { Metadata } from "next";
import * as React from "react";
import "../styles/index.css";
import "../components/Header/style.css";
import "../components/Footer/style.css";
import "../components/UploadBox/style.css";
import "../components/ResultList/style.css";
import "../components/Reveal/style.css";
import "../components/HeroMotion/style.css";
import "../components/SolutionDeck/style.css";
import "../components/CaseSlider/style.css";
import "../components/PreFooter/style.css";
import "../components/FloatingTools/style.css";
import "../views/Landing/style.css";
import "../views/Analysis/style.css";

// 전역 레이아웃과 스타일 진입점
export const metadata: Metadata = {
  title: "K리그 판정 보조",
  description: "영상 근거와 규정 대조를 제공하는 판정 보조 시스템",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
