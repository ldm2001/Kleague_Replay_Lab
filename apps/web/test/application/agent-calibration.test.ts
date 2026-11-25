// 규정 에이전트 배포 보정 자료 시험
import { describe, expect, it } from "vitest";
import { INCIDENT_OBSERVATION_KEYS, calibrationData } from "@replay/shared-types";
import {
    agentCalibration,
    calibrationLoad,
    calibrationSha256,
    released
} from "../../src/application/use-cases/agent/calibration";

// 첫 배포 판 보정 해시 고정값 정의
const FIRST = "7ff0373671c7303cd05fee2d26064e9e2ad266c3eabaae66ee6ef9875349b637";

describe("agent-calibration-v1 release", () => {
    it("ships a calibration that passes the calibration format check", () => {
        // 배포 보정의 형식 검사 결과 참 확인
        expect(calibrationData(agentCalibration)).toBe(true);
    });

    it("covers exactly the six holding observation facts", () => {
        // 배포 보정 사실 키의 정렬 목록 생성
        const keys = Object.keys(agentCalibration.facts).sort();
        // 잡기 관측 키 정렬 목록과 일치 확인
        expect(keys).toEqual([...INCIDENT_OBSERVATION_KEYS.HOLDING_MOTION].sort());
        // 사실 키 6종 확인
        expect(keys).toHaveLength(6);
    });

    it("pins the first released calibration hash", () => {
        // 첫 판 배포 해시와 고정값 일치 확인
        expect(released["1"]).toBe(FIRST);
    });

    it("maps the current version to the current calibration hash", () => {
        // 현재 판 번호 참조
        const version = agentCalibration.method.version;
        // 현재 판 배포 해시와 현재 보정 해시 일치 확인
        expect(released[version]).toBe(calibrationSha256(agentCalibration));
    });

    it("excludes status and report hash from the calibration hash", () => {
        // 미보정 상태와 보고서 해시 없음으로 바꾼 보정 생성
        const draft = {
            ...agentCalibration,
            status: "UNCALIBRATED",
            reportSha256: null
        } as const;
        // 개발 보정 완료 상태와 보고서 해시로 바꾼 보정 생성
        const done = {
            ...agentCalibration,
            status: "CALIBRATED_DEVELOPMENT",
            reportSha256: "b".repeat(64)
        } as const;
        // 두 보정의 해시 일치 확인
        expect(calibrationSha256(draft)).toBe(calibrationSha256(done));
    });

    it("includes the version and thresholds in the calibration hash", () => {
        // 현재 판 번호 참조
        const version = agentCalibration.method.version;
        // 다음 판 번호로 바꾼 보정 생성
        const next = {
            ...agentCalibration,
            method: { ...agentCalibration.method, version: String(Number(version) + 1) }
        };
        // 잡기 유지 사실 항목 참조
        const grip = agentCalibration.facts.gripMaintained;
        // 잡기 확인 시간 하한을 1ms 늘린 보정 생성
        const longer = {
            ...agentCalibration,
            facts: {
                ...agentCalibration.facts,
                gripMaintained: {
                    ...grip,
                    rule: { ...grip.rule, confirmMinMs: grip.rule.confirmMinMs + 1 }
                }
            }
        };
        // 판 번호 변경의 해시 변화 확인
        expect(calibrationSha256(next)).not.toBe(calibrationSha256(agentCalibration));
        // 문턱 변경의 해시 변화 확인
        expect(calibrationSha256(longer)).not.toBe(calibrationSha256(agentCalibration));
    });

    it("rejects loading an invalid calibration with AGENT_CALIBRATION_INVALID", () => {
        // 목록 밖 상태 보정의 적재 거절 확인
        expect(() => calibrationLoad({ ...agentCalibration, status: "CALIBRATED" }))
            .toThrow("AGENT_CALIBRATION_INVALID");
    });
});
