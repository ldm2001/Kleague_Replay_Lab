// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./index.js";

type Entry = { isIntersecting: boolean; target: Element };

describe("Reveal", () => {
    afterEach(() => {
        // 테스트 문서 구조과 전역 모형 정리
        cleanup();
        // 시험도구 전역대체복원 결과 처리 수행
        vi.unstubAllGlobals();
    });

    it("reveals once when the element enters the viewport", () => {
        // 교차 영역 감지기 모형 준비
        let callback: ((entries: Entry[]) => void) | undefined;
        // 시험자료 호출 여부와 전달 인자를 기록할 모의함수 생성
        const observe = vi.fn();
        // 시험자료 호출 여부와 전달 인자를 기록할 모의함수 생성
        const unobserve = vi.fn();
        // 시험자료 호출 여부와 전달 인자를 기록할 모의함수 생성
        const disconnect = vi.fn();
        // 시험도구 전역값대체 결과 처리 수행
        vi.stubGlobal("IntersectionObserver", vi.fn((next: (entries: Entry[]) => void) => {
            // 시험자료를 시험자료로 설정
            callback = next;
            // 기존 항목 및 기존 항목 및 기존 항목 자료 반환
            return { observe, unobserve, disconnect };
        }));

        // 지연 효과 컴포넌트 렌더링
        render(<Reveal as="section" delay={140}><span>영상 사실</span></Reveal>);
        // 요소 시험용 화면의 영상 사실 요소 요소 준비
        const element = screen.getByText("영상 사실").parentElement;
        // 요소의 지정 표시 상태 클래스 미적용 확인
        expect(element).toHaveClass("reveal");
        // 요소의 등장 지연 시간 스타일 적용 확인
        expect(element).not.toHaveClass("is-visible");
        // 요소의 등장 지연 시간 스타일 적용 확인
        expect(element).toHaveStyle("--reveal-delay: 140ms");
        // 시험도구 모의함수 반환값의 요소 인자 전달 확인
        expect(observe).toHaveBeenCalledWith(element);

        // 화면 진입 이벤트 전달
        callback?.([{ isIntersecting: true, target: element! }]);

        // 요소의 지정 표시 상태 클래스 적용 확인
        expect(element).toHaveClass("is-visible");
        // 시험도구 모의함수 반환값의 요소 인자 전달 확인
        expect(unobserve).toHaveBeenCalledWith(element);
    });
});
