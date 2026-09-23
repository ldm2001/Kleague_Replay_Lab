import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { pipelineFilter } from "@replay/rule-engine";
import { sceneEventData } from "@replay/shared-types";

// 사건 시험 입력으로 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 1000 자료 생성
const event = {
    kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
    startMs: 1000, endMs: 4000, restartMs: 2000, evidenceTimestampsMs: [1000, 1500, 2000, 3000],
};
// 후보 시험 입력으로 시작시각 0 및 종료시각 5000 및 시각 2000 및 분류 지정 문자열 자료 생성
const candidate = {
    startMs: 0, endMs: 5000, anchorMs: 2000, category: "OTHER",
    evidenceIds: ["corner-frame", "restart-frame"], sceneEvent: event,
};

describe("observed corner through the rules filter", () => {
    it("keeps a video observation and reference topics when the match edition is unknown", () => {
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter(candidate, null);
        // 결과의 상태 관측완료 및 지정 항목 코너킥 및 참조 참 자료의 필드 일치 확인
        expect(result).toMatchObject({
            status: "OBSERVED",
            situation: "CORNER_KICK",
            referenceOnly: true
        });
        // 규정 맥락 미검증 값이 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("RULE_CONTEXT_UNVERIFIED");
        // 결과 사유코드목록의 관측완료 포함 확인
        expect(result.reasonCodes).toContain("SITUATION_OBSERVED");
        // 사건 미분류 사유가 결과에 포함되지 않음 확인
        expect(result.reasonCodes).not.toContain("INCIDENT_UNCLASSIFIED");
        // 접촉 미관측 사유가 결과에 포함되지 않음 확인
        expect(result.reasonCodes).not.toContain("CONTACT_UNOBSERVED");
        // 강도 미관측 사유가 결과에 포함되지 않음 확인
        expect(result.reasonCodes).not.toContain("INTENSITY_UNOBSERVED");
        // 결과 규정 참조목록의 0개 항목 목록 기준 구조 일치 확인
        expect(result.ruleReferences).toEqual([]);
        // 결과 조건목록의 항목 수 4 확인
        expect(result.conditions).toHaveLength(4);
        // 각 규정 조건이 모두 미검증 상태로 보존됨 확인
        expect(result.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(
            true
        );
        // 결과 조건목록 조회 결과의 직접 포함 확인
        expect(
            result.conditions?.find((condition) => condition.code === "DIRECT_CORNER_OFFSIDE")
                ?.description
        ).toContain("직접");
        // 결과의 판정 항목 없음 확인
        expect(result).not.toHaveProperty("decision");
    });

    it.each(["ifab-2025-26", "ifab-2026-27"])(
        "routes a corner to actual Law 17/11 clauses for %s",
        (versionId) => {
            // 결과 시험용 파이프라인 필터 결과 준비
            const result = pipelineFilter(candidate, ruleSet(versionId));
            // 결과의 상태 적용가능 및 지정 항목 코너킥 및 참조 거짓 자료의 필드 일치 확인
            expect(result).toMatchObject({
                status: "APPLICABLE",
                situation: "CORNER_KICK",
                referenceOnly: false
            });
            // 결과 규정 참조목록 항목변환 결과의 2개 항목 목록 기준 구조 일치 확인
            expect(result.ruleReferences.map((reference) => reference.law)).toEqual(["17", "11"]);
            // 결과 규정 참조목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                result.ruleReferences.every((reference) => reference.ruleId.startsWith(versionId))
            ).toBe(true);
            // 결과 규정 참조목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                result.ruleReferences.every(
                    (reference) => reference.sourcePage && reference.sourceUrl
                )
            ).toBe(true);
            // 각 규정 조건이 모두 미검증 상태로 보존됨 확인
            expect(result.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(
                true
            );
            // 결과 조건목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                result.conditions?.every((condition) =>
                    condition.sourceUrl.includes("downloads.theifab.com")
                )
            ).toBe(true);
            // 결과의 판정 항목 없음 확인
            expect(result).not.toHaveProperty("decision");
        }
    );

    it("does not mistake an unrelated or incomplete rule catalog for corner coverage", () => {
        // 규정목록 시험용 규정집 결과 준비
        const rules = ruleSet("ifab-2026-27")!;
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter(candidate, { ...rules, cite: () => [] });
        // 결과의 상태 관측완료 및 참조 참 및 규정 참조목록 자료의 필드 일치 확인
        expect(result).toMatchObject({
            status: "OBSERVED",
            referenceOnly: true,
            ruleReferences: []
        });
        // 규정 조항 사용 불가 사유가 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("RULE_CLAUSES_UNAVAILABLE");
    });

    it("does not classify a corner from a category string without timed evidence", () => {
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter(
            { ...candidate, category: "CORNER_KICK", sceneEvent: null },
            null
        );
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 장면 사건 자료 사용 불가 사유가 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("SCENE_EVENT_UNAVAILABLE");
        // 결과의 미정의 확인
        expect(result.situation).toBeUndefined();
    });

    it("does not route an event without playable evidence", () => {
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter({ ...candidate, evidenceIds: [] }, ruleSet("ifab-2026-27"));
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 근거 사용 불가 사유가 결과에 포함됨 확인
        expect(result.reasonCodes).toContain("EVIDENCE_UNAVAILABLE");
        // 결과 규정 참조목록의 0개 항목 목록 기준 구조 일치 확인
        expect(result.ruleReferences).toEqual([]);
    });

    it.each([
        { ...event, kind: "THROW_IN" },
        { ...event, status: "CONFIRMED" },
        { ...event, method: "manual" },
        { ...event, startMs: -1 },
        { ...event, endMs: 5001 },
        { ...event, restartMs: 1000 },
        { ...event, restartMs: 4000 },
        { ...event, evidenceTimestampsMs: [] },
        { ...event, evidenceTimestampsMs: [1000] },
        { ...event, evidenceTimestampsMs: [999, 3000] },
        { ...event, evidenceTimestampsMs: [1000, 4001] },
        { ...event, evidenceTimestampsMs: [1000, 1000, 3000] },
        { ...event, evidenceTimestampsMs: [1000, 1999] },
        { ...event, evidenceTimestampsMs: [2000, 3000] },
        { ...event, evidenceTimestampsMs: [1000, Number.NaN] },
        { ...event, evidenceTimestampsMs: [1000, 2000.5] },
        {
            ...event,
            evidenceTimestampsMs: Array.from({ length: 257 }, (_, index) => 1000 + index * 10)
        }
    ])("rejects malformed or out-of-window scene observations", (sceneEvent) => {
        // 장면 사건 자료 결과의 기대값 거짓 일치 확인
        expect(sceneEventData(sceneEvent, 0, 5000)).toBe(false);
        // 장면 사건 오류 내용을 포함한 기대 결과 일치 확인
        expect(pipelineFilter({ ...candidate, sceneEvent }, null)).toMatchObject({
            status: "EXCLUDED",
            reasonCodes: ["INVALID_SCENE_EVENT"],
            ruleReferences: []
        });
    });

    it("keeps the old OTHER path unchanged when there is no observation", () => {
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter({ ...candidate, sceneEvent: undefined }, null);
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 사건 미분류 및 접촉 미관측 및 강도 미관측 내용을 포함한 기대 결과 일치 확인
        expect(result.reasonCodes).toEqual(
            expect.arrayContaining([
                "INCIDENT_UNCLASSIFIED",
                "CONTACT_UNOBSERVED",
                "INTENSITY_UNOBSERVED"
            ])
        );
    });
});
