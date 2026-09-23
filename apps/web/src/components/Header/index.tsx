"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useEffect, useRef } from "react";
import { images, path } from "../../assets/image";

// 랜딩과 분석 화면을 구분할 헤더 모드 정의
export type HeaderMode = "landing" | "analysis";

// 화면 구성에 필요한 읽기 전용 입력 속성 형식 정의
type Props = Readonly<{ mode: HeaderMode }>;

// 화면 종류별 헤더
export function Header({ mode }: Props) {
    // 랜딩 모드 확인
    const landing = mode === "landing";
    // 헤더 참조
    const header = useRef<HTMLElement>(null);

    // 스크롤 상태 연결
    useEffect(() => {
        // 랜딩 화면에서만 스크롤 상태 연결
        if (!landing) return;
        // 예약된 화면 갱신 식별자
        let frame = 0;

        // 헤더 스크롤 상태 반영
        const viewport = () => {
            // 실행한 화면 갱신 예약 식별자 초기화
            frame = 0;
            // 헤더 요소가 연결되어 있으면 스크롤 상태 반영
            if (header.current) header.current.dataset.scrolled = String(globalThis.scrollY > 1);
        };

        // 스크롤 이벤트를 다음 프레임으로 묶기
        const scrollState = () => {
            // 중복 예약 없이 다음 화면 갱신 시점에 스크롤 반영 예약
            if (frame === 0) frame = globalThis.requestAnimationFrame(viewport);
        };
        // 현재 스크롤 위치를 즉시 화면에 반영
        viewport();
        // 스크롤을 막지 않는 방식으로 위치 변경 감지 연결
        globalThis.addEventListener("scroll", scrollState, { passive: true });
        // 이벤트 해제와 예약 취소
        return () => {
            // 화면 종료 후 남지 않도록 스크롤 감지 연결 해제
            globalThis.removeEventListener("scroll", scrollState);
            // 남아 있는 화면 갱신 예약 취소
            if (frame !== 0) globalThis.cancelAnimationFrame(frame);
        };
    }, [landing]);

    // 헤더 화면 구성
    return (
        <header
            // 실제 화면 요소를 참조에 연결
            ref={header}
            className={landing ? "site-header" : "analysis-topbar"}
            data-scrolled="false"
        >
            {/* 서비스 홈 이동의 이동 링크 표시 */}
            <a className="site-brand" href={landing ? "#top" : "/"} aria-label="K리그 판정 보조 홈">
                {/* 리그 로고와 서비스 이름의 짧은 문구 표시 */}
                <span className="site-logo-lockup">
                    {landing ? (
                        <>
                            {/* 리그 로고의 이미지 표시 */}
                            <img
                                className="site-logo site-logo-light"
                                data-testid="site-logo"
                                // 표시할 영상이나 이미지 주소 연결
                                src={path(images.brandLight)}
                                // 이미지를 볼 수 없을 때 사용할 설명 연결
                                alt="K LEAGUE"
                                // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                                decoding="async"
                            />
                            {/* 리그 로고의 이미지 표시 */}
                            <img
                                className="site-logo site-logo-dark"
                                // 표시할 영상이나 이미지 주소 연결
                                src={path(images.brand)}
                                // 이미지를 볼 수 없을 때 사용할 설명 연결
                                alt=""
                                // 장식 요소를 보조 기술의 읽기 대상에서 제외
                                aria-hidden="true"
                                // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                                decoding="async"
                            />
                        </>
                    ) : (
                        // 리그 로고의 이미지 표시
                        <img
                            className="site-logo"
                            data-testid="site-logo"
                            // 표시할 영상이나 이미지 주소 연결
                            src={path(images.brand)}
                            // 이미지를 볼 수 없을 때 사용할 설명 연결
                            alt="K LEAGUE"
                            // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                            decoding="async"
                        />
                    )}
                    {/* 상단 메뉴의 보조 문구 표시 */}
                    <small>Replay Lab</small>
                </span>
            </a>

            {landing ? (
                <>
                    {/* 랜딩 메뉴 표시 */}
                    <nav className="site-nav" aria-label="주요 메뉴">
                        {/* 솔루션의 이동 링크 표시 */}
                        <a href="#solutions">솔루션</a>
                        {/* 분석 기능의 이동 링크 표시 */}
                        <a href="#services">분석 기능</a>
                        {/* 규정의 이동 링크 표시 */}
                        <a href="#rules">규정</a>
                        {/* 검토 범위의 이동 링크 표시 */}
                        <a href="#cases">검토 범위</a>
                    </nav>
                </>
            ) : (
                <>
                    {/* 분석 화면 복귀 링크 표시 */}
                    <a className="analysis-back" href="/">
                        랜딩으로 돌아가기 <span aria-hidden="true">↖</span>
                    </a>
                </>
            )}
        </header>
    );
}
