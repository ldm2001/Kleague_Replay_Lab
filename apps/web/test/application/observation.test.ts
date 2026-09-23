import { describe, expect, it } from "vitest";
import { observationData } from "@replay/shared-types";
import { reviewFacts, reviewValues } from "../../src/constant/review";
import { judgment } from "../fixtures/result";

describe("영상 관찰 계약", () => {
    it("미확인값의 임의 확정 차단", () => {
        // 선택하지 않은 불리언 조건은 거짓 값로 변환하지 않음
        expect(reviewFacts({}, ["shot"])).toBeNull();
        // 접촉이 미확인인 입력에서 규정 사실을 생성하지 않음 확인
        expect(
            reviewFacts({ ...reviewValues(judgment.facts), contact: "UNKNOWN" }, ["shot"])
        ).toBeNull();
        // 사실 결과의 빈 값 확인
        expect(reviewFacts(reviewValues(judgment.facts), [])).toBeNull();
    });
    it("모델 응답 형식 검증", () => {
        // 판정이나 빈 근거를 모델 관찰로 수용하지 않음
        const value = {
            model: "gemma3:12b",
            category: "UNKNOWN",
            contact: "UNKNOWN",
            displacement: "uncertain",
            camera: "LOW",
            summary: "접촉 확인 어려움",
            timestamps: [100, 200]
        };
        // 관측 자료 결과의 기대값 참 일치 확인
        expect(observationData(value)).toBe(true);
        // 관측 자료 결과의 기대값 거짓 일치 확인
        expect(observationData({ ...value, contact: "FOUL" })).toBe(false);
        // 관측 자료 결과의 기대값 거짓 일치 확인
        expect(observationData({ ...value, category: ["PUSHING"] })).toBe(false);
        // 관측 자료 결과의 기대값 거짓 일치 확인
        expect(observationData({ ...value, timestamps: [] })).toBe(false);
        // 관측 자료 결과의 기대값 거짓 일치 확인
        expect(observationData({ ...value, timestamps: [NaN] })).toBe(false);
    });
});
