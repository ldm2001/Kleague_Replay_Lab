// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandingView } from "./index.js";

describe("LandingView", () => {
    afterEach(() => {
        // 테스트 문서 구조 정리
        cleanup();
    });

    it("presents the adopted cloud-style landing structure with product-specific copy", () => {
        // 랜딩 화면 렌더링
        render(<LandingView />);

        // 랜딩 이미지 자산 존재 확인
        expect(existsSync(resolve("apps/web/src/assets/image/hero/kleague-ball.jpg"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/review/foul.jpg"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/review/handball.jpg"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/review/charging.webp"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/review/goal.jpg"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/brand/kleague-logo.png"))).toBe(true);
        // 파일존재여부 결과의 기대값 참 일치 확인
        expect(existsSync(resolve("apps/web/src/assets/image/brand/kleague-logo-light.png"))).toBe(
            true
        );
        // 랜딩 제목과 메뉴 확인
        expect(
            screen.getByRole("heading", { name: "경기 판정의 새로운 근거를 열다" })
        ).toBeInTheDocument();
        // 화면 시험표지조회 결과의 지정 속성 적용 확인
        expect(screen.getByTestId("hero-art")).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/hero/kleague-ball.jpg"
        );
        // 화면 시험표지조회 결과의 지정 속성 적용 확인
        expect(screen.getByTestId("site-logo")).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/brand/kleague-logo-light.png"
        );
        // 화면의 솔루션 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "솔루션" })).toHaveAttribute("href", "#solutions");
        // 화면의 분석 기능 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "분석 기능" })).toHaveAttribute(
            "href",
            "#services"
        );
        // 화면의 규정 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "규정" })).toHaveAttribute("href", "#rules");
        // 화면의 분석 시작 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("link", { name: "분석 시작" })).not.toBeInTheDocument();
        // 화면의 주요 분석 기능 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "주요 분석 기능" })).toBeInTheDocument();
        // 화면의 판정 후보 탐지 요소의 화면 표시 확인
        expect(screen.getByText("판정 후보 탐지")).toBeInTheDocument();
        // 화면의 와 리그 요강 대조 요소의 화면 표시 확인
        expect(screen.getByText("IFAB와 K리그 요강 대조")).toBeInTheDocument();
        // 화면의 근거 프레임과 클립 요소의 화면 표시 확인
        expect(screen.getByText("근거 프레임과 클립")).toBeInTheDocument();
        // 화면의 판정 결과 읽기 요소의 화면 표시 확인
        expect(screen.getByText("판정 결과 읽기")).toBeInTheDocument();
        // 화면의 영상 속 판정 근거를 확인하세요 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "영상 속 판정 근거를 확인하세요" })
        ).toBeInTheDocument();
        // 화면의 푸터 메뉴 요소의 화면 표시 확인
        expect(screen.getByRole("navigation", { name: "푸터 메뉴" })).toBeInTheDocument();
        // 화면의 맨 위로 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "맨 위로" })).toHaveAttribute("href", "#top");
        // 화면의 파울 판정 예시 요소의 지정 속성 적용 확인
        expect(screen.getByRole("img", { name: "파울 판정 예시" })).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/review/foul.jpg"
        );
        // 화면의 핸드볼 판정 예시 요소의 지정 속성 적용 확인
        expect(screen.getByRole("img", { name: "핸드볼 판정 예시" })).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/review/handball.jpg"
        );
        // 화면의 차징과 터치 판정 예시 요소의 지정 속성 적용 확인
        expect(screen.getByRole("img", { name: "차징과 터치 판정 예시" })).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/review/charging.webp"
        );
        // 화면의 득점 취소 판정 예시 요소의 지정 속성 적용 확인
        expect(screen.getByRole("img", { name: "득점 취소 판정 예시" })).toHaveAttribute(
            "src",
            "/apps/web/src/assets/image/review/goal.jpg"
        );
        // 화면의 기대값 영상 분석 시작하기 요소 전체충족 결과의 참 일치 확인
        expect(
            screen
                .getAllByRole("link", { name: "영상 분석 시작하기" })
                .every((link) => link.getAttribute("href") === "/analyze")
        ).toBe(true);
        // 화면의 기대값 분석 흐름 보기 요소 전체충족 결과의 참 일치 확인
        expect(
            screen
                .getAllByRole("link", { name: "분석 흐름 보기" })
                .every((link) => link.getAttribute("href") === "/analyze")
        ).toBe(true);
        // 화면의 경기 영상 업로드 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("heading", { name: "경기 영상 업로드" })).not.toBeInTheDocument();
    });
});
