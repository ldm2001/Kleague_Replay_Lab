// 밀기 판정 테스트
import type { PushFacts } from "@replay/shared-types";
import { observation } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { pushResult } from "@replay/rule-engine";
import { context } from "../fixtures/push-context";

// 규정목록 시험용 규정집 결과 준비
const rules = ruleSet("ifab-2025-26")!;

// 기본자료 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
const base: PushFacts = {
    contactDetected: observation(true, "NORMAL", ["shot-1"]),
    severity: observation("RECKLESS", "NORMAL", ["shot-1"]),
    opponentDisplacement: observation("clear", "NORMAL", ["shot-1"]),
    insidePenaltyArea: observation(false, "NORMAL", ["shot-1"]),
    cameraSufficiency: "HIGH",
    context: context(),
};

describe("pushResult", () => {
    it("사실값이 막혀도 규정 설명은 그대로 나온다", () => {
        // 결과 시험용 밀기평가결과 결과 준비
        const result = pushResult({ ...base, cameraSufficiency: "LOW" }, rules);
        // 결과의 판단 불가 상태 일치 확인
        expect(result.decision).toBe("INCONCLUSIVE");
        // 결과의 판단 설명 목록이 비어 있지 않음 확인
        expect(result.accounts).not.toHaveLength(0);
        // 첫 판단 설명에 필요한 전제조건 목록이 비어 있지 않음 확인
        expect(result.accounts[0]!.requires).not.toHaveLength(0);
        // 판단을 막는 조건 목록이 비어 있지 않음 확인
        expect(result.blockedFrom).not.toHaveLength(0);
        // 결과 인용목록 길이의 1 이상 확인
        expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it("밀기 경로에서는 VAR 판단을 계산하지 않는다", () => {
        // 밀기평가결과 결과 비디오판독평가의 빈 값 확인
        expect(pushResult(base, rules).varAssessment).toBeNull();
    });

    it("인용은 ruleId 기준으로 중복 없이 모인다", () => {
        // 식별자목록 시험용 밀기평가결과 결과 인용목록 항목변환 결과 준비
        const ids = pushResult(base, rules).citations.map((citation) => citation.ruleId);
        // 집합 크기의 기대값 식별자목록 길이 일치 확인
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("서명은 결정적이고 shotIds에 흔들리지 않는다", () => {
        // 첫결과 시험용 밀기평가결과 결과 준비
        const first = pushResult(base, rules);
        // 두번째결과 시험용 밀기평가결과 결과 준비
        const second = pushResult(
            { ...base, contactDetected: observation(true, "NORMAL", ["shot-77"]) },
            rules
        );
        // 첫결과 사실 서명의 기대값 두번째결과 사실 서명 일치 확인
        expect(first.factSignature).toBe(second.factSignature);
        // 첫결과 사실 서명의 지정 패턴 일치 확인
        expect(first.factSignature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("관측 판정이 없으므로 비교 결과는 UNDETERMINED다", () => {
        // 결과가 미확정 상태로 유지됨 확인
        expect(pushResult(base, rules).decisionMatch).toBe("UNDETERMINED");
    });

    it("파울 경로는 강도·재개·징계를 함께 채운다", () => {
        // 결과 시험용 밀기평가결과 결과 준비
        const result = pushResult(
            {
                ...base,
                context: context(true),
                insidePenaltyArea: observation(true, "NORMAL", ["shot-1"])
            },
            rules
        );
        // 결과 판정의 기대값 파울 일치 확인
        expect(result.decision).toBe("FOUL");
        // 결과 강도의 기대값 지정 문자열 일치 확인
        expect(result.severity).toBe("RECKLESS");
        // 결과 재개의 기대값 페널티킥 일치 확인
        expect(result.restart).toBe("PENALTY_KICK");
        // 결과 징계의 기대값 지정 문자열 일치 확인
        expect(result.disciplinary).toBe("CAUTION");
        // 결과 사유의 빈 값 확인
        expect(result.inconclusiveReason).toBeNull();
    });

    it("판정 맥락이 달라지면 서명도 달라진다", () => {
        // 첫결과 시험용 밀기평가결과 결과 준비
        const first = pushResult(base, rules);
        // 두번째결과 시험용 밀기평가결과 결과 준비
        const second = pushResult(
            { ...base, context: { ...context(), ballInPlay: observation(null, "NORMAL", []) } },
            rules
        );
        // 첫결과 사실 서명의 기대값 두번째결과 사실 서명 불일치 확인
        expect(first.factSignature).not.toBe(second.factSignature);
    });
});
