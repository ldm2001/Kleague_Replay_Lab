// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SolutionDeck } from "./index.js";

describe("SolutionDeck", () => {
    afterEach(() => {
        // 테스트 문서 구조 정리
        cleanup();
    });

    it("expands the focused solution and updates its content", () => {
        // 솔루션 패널 렌더링
        render(<SolutionDeck />);
        // 시험자료 시험용 화면 역할요소목록조회 결과 준비
        const tabs = screen.getAllByRole("tab");
        // 화면 조회 전체 반환값 중 선택 항목의 지정 속성 적용 확인
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        // 화면의 영상 근거 중심의 판정 보조 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "영상 근거 중심의 판정 보조" })).toBeInTheDocument();

        // 두 번째 탭 포커스 전달
        fireEvent.focus(tabs[1]!);

        // 화면 조회 전체 반환값 중 선택 항목의 지정 속성 적용 확인
        expect(tabs[1]!).toHaveAttribute("aria-selected", "true");
        // 화면의 적용 규정과 판본 확인 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "적용 규정과 판본 확인" })).toBeInTheDocument();
        // 화면 역할요소목록조회 결과의 항목 수 1 확인
        expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
        // 시험자료 조회 요소 식별자 결과의 지정 표시 상태 클래스 적용 확인
        expect(document.getElementById("solution-panel")).toHaveClass("is-active");
    });
});
