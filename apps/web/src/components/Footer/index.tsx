// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";

// 하단 메뉴의 제목과 이동 링크 묶음 생성
const columns = [
    {
        // 카드 제목 연결
        title: "분석 흐름",
        // 메뉴 이름과 이동 주소 목록 연결
        links: [
            ["영상 업로드", "/analyze"],
            ["후보 탐지", "#solutions"],
            ["규정 대조", "#rules"],
            ["결과 확인", "/analyze"]
        ]
    },
    {
        // 카드 제목 연결
        title: "검토 범위",
        // 메뉴 이름과 이동 주소 목록 연결
        links: [
            ["파울", "#cases"],
            ["핸드볼", "#cases"],
            ["차징과 터치", "#cases"],
            ["득점 취소", "#cases"]
        ]
    },
    {
        // 카드 제목 연결
        title: "이용 안내",
        // 메뉴 이름과 이동 주소 목록 연결
        links: [
            ["분석 권한", "#top"],
            ["낮은 확신도", "#rules"],
            ["영상 한계", "#rules"],
            ["개인정보 안내", "#top"]
        ]
    }
] as const;

// 푸터 정보 화면
// 공통 푸터
export function Footer() {
    // 공통 하단 정보 구성
    return (
        <footer className="site-footer">
            {/* 하단 소개와 메뉴의 화면 묶음 표시 */}
            <div className="footer-inner">
                {/* 서비스 이름과 설명의 화면 묶음 표시 */}
                <div className="footer-brand">
                    {/* 하단 브랜드 장식의 짧은 문구 표시 */}
                    <span className="site-mark" aria-hidden="true">
                        {/* 하단 메뉴의 짧은 문구 표시 */}
                        <span />
                    </span>
                    {/* 하단 메뉴의 강조 문구 표시 */}
                    <strong>K LEAGUE Replay Lab</strong>
                    {/* 영상 근거와 공개 규정을 비교하는 판정 보조 시스템의 안내 문구 표시 */}
                    <p>영상 근거와 공개 규정을 비교하는 판정 보조 시스템</p>
                </div>
                {/* 하단 이동 메뉴의 이동 메뉴 표시 */}
                <nav className="footer-nav" aria-label="푸터 메뉴">
                    {/* 푸터 메뉴 열 구성 */}
                    {columns.map((column) => (
                        // 하단 메뉴의 화면 묶음 표시
                        <div key={column.title}>
                            {/* 하단 메뉴의 구역 제목 표시 */}
                            <h2>{column.title}</h2>
                            {/* 하단 메뉴의 순서 없는 목록 표시 */}
                            <ul>
                                {column.links.map(([label, href]) => (
                                    // 하단 메뉴의 목록 항목 표시
                                    <li key={label}>
                                        {/* 하단 메뉴의 이동 링크 표시 */}
                                        <a href={href}>{label}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>
            </div>
            {/* 공식 판정 아님 안내와 저작권의 화면 묶음 표시 */}
            <div className="footer-bottom">
                {/* 공식 판정이 아닌 기술적 보조 의견입니다의 보조 문구 표시 */}
                <small>공식 판정이 아닌 기술적 보조 의견입니다</small>
                {/* ©의 보조 문구 표시 */}
                <small>© K LEAGUE Replay Lab</small>
            </div>
        </footer>
    );
}
