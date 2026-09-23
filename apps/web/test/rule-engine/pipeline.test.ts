import { describe, expect, it } from "vitest";
import * as engine from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";

// 후보 시험 입력으로 시작시각 0 및 종료시각 2000 및 시각 1000 및 근거 식별자목록 자료 생성
const candidate = {
    startMs: 0, endMs: 2000, anchorMs: 1000,
    evidenceIds: ["frame-1"], category: "OTHER", signalScore: 1,
};

describe("pipeline rule filter", () => {
    it("never turns a visual change score into contact or a foul", () => {
        // 결과 시험용 시험자료 파이프라인 필터 결과 준비
        const result = engine.pipelineFilter(candidate, null);
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 규정 맥락 미검증 값이 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("RULE_CONTEXT_UNVERIFIED");
        // 사건 미분류 사유가 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("INCIDENT_UNCLASSIFIED");
        // 결과 누락 항목목록의 시험자료 부분배열 결과 기준 구조 일치 확인
        expect(result.missingFields).toEqual(expect.arrayContaining(["contact", "intensity"]));
        // 결과 규정 참조목록의 0개 항목 목록 기준 구조 일치 확인
        expect(result.ruleReferences).toEqual([]);
        // 결과의 판정 항목 없음 확인
        expect(result).not.toHaveProperty("decision");
    });

    it("checks requirements even when a verified rule set is available", () => {
        // 결과 시험용 시험자료 파이프라인 필터 결과 준비
        const result = engine.pipelineFilter(candidate, ruleSet("ifab-2026-27"));
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 규정 맥락 미검증 값이 결과에 포함되지 않음 확인
        expect(result.reasonCodes).not.toContain("RULE_CONTEXT_UNVERIFIED");
        // 접촉 미관측 사유가 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("CONTACT_UNOBSERVED");
        // 결과 규정 참조목록 길이의 0 초과 확인
        expect(result.ruleReferences.length).toBeGreaterThan(0);
        // 결과 근거 식별자목록의 1개 항목 목록 기준 구조 일치 확인
        expect(result.evidenceIds).toEqual(["frame-1"]);
    });

    it.each([
        { ...candidate, startMs: -1 },
        { ...candidate, endMs: 0 },
        { ...candidate, anchorMs: 3000 },
        { ...candidate, startMs: Number.NaN },
    ])("excludes invalid timeline metadata without a football decision", (value) => {
        // 시간 구간 오류 내용을 포함한 기대 결과 일치 확인
        expect(engine.pipelineFilter(value, null)).toMatchObject({
            status: "EXCLUDED", reasonCodes: ["INVALID_INTERVAL"], ruleReferences: [],
        });
    });

    it("keeps a valid candidate with unavailable evidence as undetermined", () => {
        // 근거 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(engine.pipelineFilter({ ...candidate, evidenceIds: [] }, null)).toMatchObject({
            status: "UNDETERMINED", reasonCodes: expect.arrayContaining(["EVIDENCE_UNAVAILABLE"]),
        });
    });
});
