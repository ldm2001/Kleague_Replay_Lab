"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useEffect, useRef } from "react";

// 화면 구성에 필요한 읽기 전용 입력 속성 형식 정의
type Props = Readonly<{
    // 화면 요소 종류 형식 정의
    as?: "article" | "div" | "section";
    // 내부에 표시할 화면 형식 정의
    children: React.ReactNode;
    // 화면 스타일 이름 형식 정의
    className?: string;
    // 화면 진입 지연 시간 형식 정의
    delay?: number;
}>;

// 화면 진입 감지
export function Reveal({ as: Tag = "div", children, className = "", delay = 0 }: Props) {
    // 관찰 대상 참조
    const element = useRef<HTMLElement>(null);

    // 화면 진입 효과 연결
    useEffect(() => {
        // 관찰 대상 확보
        const target = element.current;
        // 실제 화면 요소가 없으면 효과 연결 종료
        if (!target) return;
        // 모션 감소 환경 확인
        const reduced =
            globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        // 모션을 사용할 수 없으면 즉시 표시
        if (reduced || !("IntersectionObserver" in globalThis)) {
            // 숨겨진 화면 요소를 보이는 상태로 전환
            target.classList.add("is-visible");
            // 즉시 표시 후 화면 진입 관찰 생략
            return;
        }
        // 화면 진입 관찰자 생성
        const observer = new IntersectionObserver(
            (entries) => {
                // 화면에 들어오지 않은 대상 무시
                if (!entries.some((entry) => entry.isIntersecting)) return;
                // 진입 상태 클래스 추가
                target.classList.add("is-visible");
                // 한 번 표시한 대상 관찰 중지
                observer.unobserve(target);
            },
            { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
        );
        // 관찰 대상 등록
        observer.observe(target);
        // 화면 종료 시 관찰 해제
        return () => observer.disconnect();
    }, []);

    // 진입 지연 스타일
    const style = { "--reveal-delay": `${delay}ms` } as React.CSSProperties;

    // 효과 대상 반환
    return React.createElement(
        Tag,
        {
            // 실제 화면 요소 참조 연결
            ref: element as unknown as React.Ref<HTMLDivElement>,
            // 화면 스타일 이름 연결
            className: `reveal ${className}`.trim(),
            // 화면 진입 지연 스타일 연결
            style
        },
        children
    );
}
