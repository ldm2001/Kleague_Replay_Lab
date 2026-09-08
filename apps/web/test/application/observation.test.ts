import { describe, expect, it } from "vitest";
import { observationData } from "@replay/shared-types";
import { reviewFacts, reviewValues } from "../../src/constant/review";
import { judgment } from "../fixtures/result";

describe("영상 관찰 계약", () => {
  it("미확인값의 임의 확정 차단", () => {
    // 선택하지 않은 불리언 조건은 false로 변환하지 않음
    expect(reviewFacts({}, ["shot"])).toBeNull();
    expect(reviewFacts({ ...reviewValues(judgment.facts), contact: "UNKNOWN" }, ["shot"])).toBeNull();
    expect(reviewFacts(reviewValues(judgment.facts), [])).toBeNull();
  });
  it("모델 응답 형식 검증", () => {
    // 판정이나 빈 근거를 모델 관찰로 수용하지 않음
    const value = { model: "gemma3:12b", category: "UNKNOWN", contact: "UNKNOWN", displacement: "uncertain", camera: "LOW", summary: "접촉 확인 어려움", timestamps: [100, 200] };
    expect(observationData(value)).toBe(true);
    expect(observationData({ ...value, contact: "FOUL" })).toBe(false);
    expect(observationData({ ...value, category: ["PUSHING"] })).toBe(false);
    expect(observationData({ ...value, timestamps: [] })).toBe(false);
    expect(observationData({ ...value, timestamps: [NaN] })).toBe(false);
  });
});
