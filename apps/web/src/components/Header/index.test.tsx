// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./index.js";

describe("Header", () => {
    afterEach(() => {
        // 테스트 문서 구조과 모형 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
    });

    it("switches to the compact header after scrolling", () => {
        // 애니메이션 프레임 모형 구성
        vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
            // 애니메이션 프레임 콜백을 시작 시각으로 호출
            callback(0);
            // 1 반환
            return 1;
        });
        // 랜딩 헤더 렌더링
        render(<Header mode="landing" />);
        // 시험자료 시험용 시험자료 요소조회 결과 준비
        const header = document.querySelector(".site-header");
        // 질의 반환값의 지정 속성 적용 확인
        expect(header).toHaveAttribute("data-scrolled", "false");

        // 객체 결과 처리 수행
        Object.defineProperty(globalThis, "scrollY", { configurable: true, value: 120 });
        // 스크롤 이벤트 전달
        globalThis.dispatchEvent(new Event("scroll"));

        // 질의 반환값의 지정 속성 적용 확인
        expect(header).toHaveAttribute("data-scrolled", "true");
    });
});
