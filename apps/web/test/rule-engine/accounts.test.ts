import type { PushFacts } from "@replay/shared-types";
import { observation } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { pushAccounts } from "@replay/rule-engine";
import { context } from "../fixtures/push-context";

// 규정목록 시험용 규정집 결과 준비
const rules = ruleSet("ifab-2025-26")!;

// 사실 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
const establishedFacts: PushFacts = {
    contactDetected: observation(true, "NORMAL", ["shot-1"]),
    severity: observation("RECKLESS", "NORMAL", ["shot-1"]),
    opponentDisplacement: observation("clear", "NORMAL", ["shot-1"]),
    insidePenaltyArea: observation(false, "NORMAL", ["shot-1"]),
    cameraSufficiency: "HIGH",
    context: context(),
};

// 검증용 요구 조건 구성
const requirement = (facts: PushFacts, name: string) =>
    pushAccounts(facts, rules).accounts[0]!.requires.find((entry) => entry.fact === name)!;

describe("pushAccounts", () => {
    it("사실값이 전부 서면 blockedFrom이 비고 징계 조항까지 내려간다", () => {
        // 화면자료 시험용 밀기설명목록 결과 준비
        const view = pushAccounts(establishedFacts, rules);
        // 화면자료 설명목록의 항목 수 1 확인
        expect(view.accounts).toHaveLength(1);
        // 화면자료 설명목록 중 선택 항목 권한의 기대값 지정 문자열 일치 확인
        expect(view.accounts[0]!.authority).toBe("IFAB");
        // 화면자료 보류 변환의 0개 항목 목록 기준 구조 일치 확인
        expect(view.blockedFrom).toEqual([]);
        // 화면자료 항목변환 결과의 1 포함 확인
        expect(view.narrowedTo.map((citation) => citation.section)).toContain("1");
        // 화면자료 길이의 2 이상 확인
        expect(view.narrowedTo.length).toBeGreaterThanOrEqual(2);
    });

    it("각도가 부족해도 accounts는 비지 않고 요구 사실이 그대로 나열된다", () => {
        // 화면자료 시험용 밀기설명목록 결과 준비
        const view = pushAccounts({ ...establishedFacts, cameraSufficiency: "LOW" }, rules);
        // 화면자료 설명목록의 항목 수 1 확인
        expect(view.accounts).toHaveLength(1);
        // 화면자료 설명목록 중 선택 항목 인용목록 길이의 0 초과 확인
        expect(view.accounts[0]!.citations.length).toBeGreaterThan(0);
        // 화면자료 설명목록 중 선택 항목 항목변환 결과의 10개 항목 목록 기준 구조 일치 확인
        expect(view.accounts[0]!.requires.map((entry) => entry.fact)).toEqual([
            "contactDetected",
            "severity",
            "opponentDisplacement",
            "insidePenaltyArea",
            "context.ballInPlay",
            "context.onField",
            "context.againstOpponent",
            "context.offenderRole",
            "context.insideOwnPenaltyArea",
            "context.disciplinaryContext"
        ]);
        // 화면자료 보류 변환의 항목 수 10 확인
        expect(view.blockedFrom).toHaveLength(10);
        // 화면자료 보류 변환 전체충족 결과의 기대값 참 일치 확인
        expect(view.blockedFrom.every((entry) => entry.blockedBy === "CAMERA")).toBe(true);
    });

    it("미확인 접촉과 누락된 맥락을 확정 사실로 나열하지 않는다", () => {
        // 맥락 맥락 기존형식 시험용 사실 준비
        const { context: _context, ...legacy } = establishedFacts;
        // 결과 시험용 밀기설명목록 결과 준비
        const result = pushAccounts(
            { ...legacy, contactDetected: observation(null, "NORMAL", []) },
            rules
        );
        // 결과 보류 변환 항목변환 결과의 시험자료 부분배열 결과 기준 구조 일치 확인
        expect(result.blockedFrom.map((item) => item.fact)).toEqual(
            expect.arrayContaining([
                "contactDetected",
                "context.ballInPlay",
                "context.offenderRole",
                "context.disciplinaryContext"
            ])
        );
    });

    it("슬로우모션에서만 본 강도는 SPEED로 막힌다", () => {
        // 사실 시험 입력으로 기존 항목 및 강도 자료 생성
        const facts: PushFacts = {
            ...establishedFacts,
            severity: observation("EXCESSIVE_FORCE", "SLOW", ["shot-2"])
        };
        // 강도 시험용 시험자료 결과 준비
        const severity = requirement(facts, "severity");
        // 강도 상태의 기대값 지정 문자열 일치 확인
        expect(severity.status).toBe("UNMET");
        // 강도 보류의 기대값 지정 문자열 일치 확인
        expect(severity.blockedBy).toBe("SPEED");
        // 시험자료 결과 상태의 기대값 지정 문자열 일치 확인
        expect(requirement(facts, "contactDetected").status).toBe("ESTABLISHED");
    });

    it("정상 속도로 봤지만 값을 특정 못한 경우는 blockedBy가 null이다", () => {
        // 사실 시험 입력으로 기존 항목 및 강도 자료 생성
        const facts: PushFacts = {
            ...establishedFacts,
            severity: observation("uncertain", "NORMAL", ["shot-1"])
        };
        // 강도 시험용 시험자료 결과 준비
        const severity = requirement(facts, "severity");
        // 강도 상태의 기대값 지정 문자열 일치 확인
        expect(severity.status).toBe("UNMET");
        // 강도 보류의 빈 값 확인
        expect(severity.blockedBy).toBeNull();
    });

    it("밀림이 possible이면 관측은 됐어도 요구 사실은 서지 않는다", () => {
        // 사실 시험 입력으로 기존 항목 및 상대이동 자료 생성
        const facts: PushFacts = {
            ...establishedFacts,
            opponentDisplacement: observation("possible", "NORMAL", ["shot-1"])
        };
        // 시험자료 시험용 시험자료 결과 준비
        const displacement = requirement(facts, "opponentDisplacement");
        // 가능 여부 값의 차단 상태 확인
        expect(displacement.status).toBe("UNMET");
        // 시험자료 보류의 빈 값 확인
        expect(displacement.blockedBy).toBeNull();
        // 밀기설명목록 결과 보류 변환의 항목 수 1 확인
        expect(pushAccounts(facts, rules).blockedFrom).toHaveLength(1);
    });

    it("강도가 막히면 징계 조항으로 내려가지 못하고 narrowsTo가 그 조항을 가리킨다", () => {
        // 사실 시험 입력으로 기존 항목 및 강도 자료 생성
        const facts: PushFacts = {
            ...establishedFacts,
            severity: observation("RECKLESS", "SLOW", ["shot-2"])
        };
        // 화면자료 시험용 밀기설명목록 결과 준비
        const view = pushAccounts(facts, rules);
        // 강도 시험용 화면자료 설명목록 중 선택 항목 조회 결과 준비
        const severity = view.accounts[0]!.requires.find((entry) => entry.fact === "severity")!;
        // 강도 규정 식별자의 기대값 2025 26 조항 12 1 일치 확인
        expect(severity.narrowsTo?.ruleId).toBe("ifab-2025-26-law-12-1-discipline");
        // 화면자료 항목변환 결과의 2025 26 조항 12 1 미포함 확인
        expect(view.narrowedTo.map((citation) => citation.ruleId)).not.toContain(
            "ifab-2025-26-law-12-1-discipline"
        );
    });

    it("확인되지 않은 계층 충돌을 만들어내지 않는다", () => {
        // 밀기설명목록 결과의 0개 항목 목록 기준 구조 일치 확인
        expect(pushAccounts(establishedFacts, rules).conflicts).toEqual([]);
    });
});
