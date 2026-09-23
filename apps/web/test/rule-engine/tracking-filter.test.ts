import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { pipelineFilter } from "@replay/rule-engine";
import { trackingData } from "@replay/shared-types";

// 장면 시험 입력으로 시작시각 0 및 종료시각 2000 및 시각 1000 및 분류 지정 문자열 자료 생성
const scene = {
    startMs: 0,
    endMs: 2000,
    anchorMs: 1000,
    category: "OTHER",
    evidenceIds: ["frame"]
};
// 추적 시험 입력으로 버전 지정 문자열 및 분석범위 완료 및 개수 30 및 개수 20 자료 생성
const tracking = {
    version: "ball-path-v1",
    // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
    coverage: "COMPLETE",
    sampleCount: 30,
    selectedCount: 20,
    cameraCount: 18,
    motionOnsetsMs: [1000]
};

describe("tracking through the rules filter", () => {
    it("valid motion evidence still cannot establish contact or a foul", () => {
        // 추적 자료 결과의 기대값 참 일치 확인
        expect(trackingData(tracking, 0, 2000)).toBe(true);
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter({ ...scene, tracking }, ruleSet("ifab-2026-27"));
        // 결과 추적 상태의 기대값 지정 문자열 일치 확인
        expect(result.trackingStatus).toBe("MOTION_ONSET");
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 접촉 미관측 및 강도 미관측 및 사건 미분류 내용을 포함한 기대 결과 일치 확인
        expect(result.reasonCodes).toEqual(
            expect.arrayContaining([
                "CONTACT_UNOBSERVED",
                "INTENSITY_UNOBSERVED",
                "INCIDENT_UNCLASSIFIED"
            ])
        );
        // 결과 규정 참조목록 길이의 0 초과 확인
        expect(result.ruleReferences.length).toBeGreaterThan(0);
        // 결과의 판정 항목 없음 확인
        expect(result).not.toHaveProperty("decision");
    });

    it.each([
        [null, "UNAVAILABLE", "TRACKING_UNAVAILABLE"],
        [{ ...tracking, coverage: "PARTIAL" }, "PARTIAL", "TRACKING_INCOMPLETE"],
        [
            { ...tracking, cameraCount: 0, motionOnsetsMs: [] },
            "POSITION_ONLY",
            "CAMERA_MOTION_UNVERIFIED"
        ],
        [
            { ...tracking, selectedCount: 0, cameraCount: 0, motionOnsetsMs: [] },
            "UNAVAILABLE",
            "TRACKING_UNAVAILABLE"
        ]
    ])("preserves incomplete or unavailable evidence", (value, state, reason) => {
        // 결과 시험용 파이프라인 필터 결과 준비
        const result = pipelineFilter({ ...scene, tracking: value }, null);
        // 결과가 미확정 상태로 유지됨 확인
        expect(result.status).toBe("UNDETERMINED");
        // 결과 추적 상태의 기대값 상태 일치 확인
        expect(result.trackingStatus).toBe(state);
        // 결과 사유코드목록의 사유 포함 확인
        expect(result.reasonCodes).toContain(reason);
    });

    it.each([
        { ...tracking, cameraCount: 21 },
        { ...tracking, selectedCount: 31 },
        { ...tracking, sampleCount: -1 },
        { ...tracking, motionOnsetsMs: [2001] },
        { ...tracking, motionOnsetsMs: [1000, 1000] },
        { ...tracking, cameraCount: 1 },
        { ...tracking, version: "unknown" }
    ])("excludes malformed measurements", (value) => {
        // 추적 자료 결과의 기대값 거짓 일치 확인
        expect(trackingData(value, 0, 2000)).toBe(false);
        // 추적 자료 오류 내용을 포함한 기대 결과 일치 확인
        expect(pipelineFilter({ ...scene, tracking: value }, null)).toMatchObject({
            status: "EXCLUDED",
            reasonCodes: ["INVALID_TRACKING"]
        });
    });
});
