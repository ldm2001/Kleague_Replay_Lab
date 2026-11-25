// 해시 계산 도구 가져오기
import { createHash as digest } from "node:crypto";
// 보정 형식 검사와 보정 자료형 가져오기
import { calibrationData, type AgentCalibration } from "@replay/shared-types";
// 배포 보정 자료 가져오기
import calibration from "./calibration.json" with { type: "json" };

// 배포 판 번호별 보정 해시 대응 정의
export const released: Readonly<Record<string, string>> = Object.freeze({
    // 첫 배포 판 보정 해시
    "1": "7ff0373671c7303cd05fee2d26064e9e2ad266c3eabaae66ee6ef9875349b637"
});

// 상태와 보고서 해시를 뺀 보정 해시 반환
export function calibrationSha256(c: AgentCalibration): string {
    // 해시 대상 정의
    const target = { schemaVersion: c.schemaVersion, method: c.method, facts: c.facts };
    // 해시 대상 직렬화의 16진 해시 반환
    return digest("sha256").update(JSON.stringify(target)).digest("hex");
}

// 형식 검사를 통과한 보정 반환
export function calibrationLoad(v: unknown): AgentCalibration {
    // 형식 위반 보정 거절
    if (!calibrationData(v)) throw new Error("AGENT_CALIBRATION_INVALID");
    // 검사한 보정 반환
    return v;
}

// 배포 보정 자료 공개
export const agentCalibration = calibrationLoad(calibration);
