"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useEffect, useRef } from "react";

// 화면 구성에 필요한 읽기 전용 입력 속성 형식 정의
type Props = React.PropsWithChildren<React.ComponentPropsWithoutRef<"section">>;

// 스크롤 상태 연결
export function HeroMotion({ children, className, ...props }: Props) {
    // 영웅 영역 참조
    const element = useRef<HTMLElement>(null);

    // 수동 스크롤 감지
    useEffect(() => {
        // 영웅 영역 스크롤 대상 확인
        const target = element.current;
        // 실제 화면 요소가 없으면 효과 연결 종료
        if (!target) return;
        // 예약된 화면 갱신 식별자
        let frame = 0;

        // 영웅 영역의 스크롤 상태 반영
        const viewport = () => {
            // 실행한 화면 갱신 예약 식별자 초기화
            frame = 0;
            // 맨 위에서 벗어났는지 화면 속성에 기록
            target.dataset.scrolled = String(globalThis.scrollY > 1);
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
        // 스크롤 이벤트 정리
        return () => {
            // 화면 종료 후 남지 않도록 스크롤 감지 연결 해제
            globalThis.removeEventListener("scroll", scrollState);
            // 남아 있는 화면 갱신 예약 취소
            if (frame !== 0) globalThis.cancelAnimationFrame(frame);
        };
    }, []);

    // 영웅 영역 반환
    return (
        <section ref={element} className={className ? `hero ${className}` : "hero"} {...props}>
            {children}
        </section>
    );
}
