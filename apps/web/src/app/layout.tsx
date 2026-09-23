// 페이지 메타데이터와 서버 화면 계약 가져옴
import type { Metadata } from "next";
// 화면 자식 요소의 자료형 가져옴
import * as React from "react";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../styles/index.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/Header/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/Footer/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/UploadPanel/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/SceneView/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/SceneList/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/RulePanel/style.css";
// 장면별 사실 확인 스타일
import "../components/FactPanel/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/Reveal/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/HeroMotion/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/SolutionDeck/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/CaseSlider/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/PreFooter/style.css";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import "../components/FloatingTools/style.css";
// 페이지에 표시할 화면 구성 요소 가져옴
import "../views/Landing/style.css";
// 페이지에 표시할 화면 구성 요소 가져옴
import "../views/Analysis/style.css";
// 페이지에 표시할 화면 구성 요소 가져옴
import "../views/Result/style.css";

// 전역 레이아웃과 스타일 진입점
export const metadata: Metadata = {
    // 브라우저 제목
    title: "K리그 판정 보조",
    // 검색 설명
    description: "영상 근거와 규정 대조를 제공하는 판정 보조 시스템",
};

// 공통 화면 구성
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
    // 한국어 문서 루트 구성
    return (
        <html lang="ko">
            {/* 현재 라우트 화면 출력 */}
            <body>{children}</body>
        </html>
    );
}
