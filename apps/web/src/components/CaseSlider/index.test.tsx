// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseSlider } from "./index.js";

// 항목목록 시험용 4개 항목 목록 준비
const items = [
    { title: "파울", text: "접촉과 강도를 확인합니다", tone: "blue", image: "/foul.jpg" },
    { title: "핸드볼", text: "공과 팔의 위치를 확인합니다", tone: "red", image: "/handball.jpg" },
    { title: "차징과 터치", text: "경합과 마지막 터치를 확인합니다", tone: "green", image: "/charging.webp" },
    { title: "득점 취소", text: "득점 직전 상황을 확인합니다", tone: "violet", image: "/goal.jpg" },
] as const;

describe("CaseSlider", () => {
    afterEach(() => {
        // 테스트 문서 구조과 모형 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
    });

    it("moves the review range strip with the navigation buttons", () => {
        // 스크롤 모형 구성
        Object.defineProperty(HTMLElement.prototype, "scrollBy", {
            configurable: true,
            value: () => undefined
        });
        // 검토 범위 슬라이더 렌더링
        const scrollBy = vi
            .spyOn(HTMLElement.prototype, "scrollBy")
            .mockImplementation(() => undefined);
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<CaseSlider items={items} />);

        // 화면의 이전 검토 범위 요소의 비활성화 상태 확인
        expect(screen.getByRole("button", { name: "이전 검토 범위" })).toBeDisabled();
        // 다음 카드 이동
        fireEvent.click(screen.getByRole("button", { name: "다음 검토 범위" }));

        // 시험도구 모의동작 반환값의 지정 항목 340 및 지정 항목 지정 문자열 자료 인자 전달 확인
        expect(scrollBy).toHaveBeenCalledWith({ left: 340, behavior: "smooth" });
        // 화면의 이전 검토 범위 요소의 활성화 상태 확인
        expect(screen.getByRole("button", { name: "이전 검토 범위" })).not.toBeDisabled();
    });
});
