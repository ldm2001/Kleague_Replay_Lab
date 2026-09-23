// 사실 서명 테스트
import { describe, expect, it } from "vitest";
import { factSignature, FORBIDDEN_SIGNATURE_KEY_PATTERN } from "@replay/rule-engine";

describe("factSignature", () => {
    it("같은 입력은 항상 같은 64자리 서명을 낸다", () => {
        // 첫결과 시험용 사실 서명 결과 준비
        const first = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
        // 두번째결과 시험용 사실 서명 결과 준비
        const second = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
        // 첫결과 서명의 기대값 두번째결과 서명 일치 확인
        expect(first.signature).toBe(second.signature);
        // 첫결과 서명의 지정 패턴 일치 확인
        expect(first.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("키 순서가 달라도 같은 서명을 낸다", () => {
        // 시험자료 시험용 사실 서명 결과 준비
        const a = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
        // 시험자료 시험용 사실 서명 결과 준비
        const b = factSignature({ insidePenaltyArea: false, severity: "RECKLESS" });
        // 사실 서명 반환값 서명의 기대값 사실 서명 반환값 서명 일치 확인
        expect(a.signature).toBe(b.signature);
    });

    it("값이 하나만 달라도 서명이 달라진다", () => {
        // 시험자료 시험용 사실 서명 결과 준비
        const a = factSignature({ severity: "RECKLESS" });
        // 시험자료 시험용 사실 서명 결과 준비
        const b = factSignature({ severity: "CARELESS" });
        // 사실 서명 반환값 서명의 기대값 사실 서명 반환값 서명 불일치 확인
        expect(a.signature).not.toBe(b.signature);
    });

    it("shotIds는 서명에서 빠진다", () => {
        // 시험자료 시험용 사실 서명 결과 준비
        const a = factSignature({ severity: "RECKLESS", shotIds: ["shot-1"] });
        // 시험자료 시험용 사실 서명 결과 준비
        const b = factSignature({ severity: "RECKLESS", shotIds: ["shot-9", "shot-12"] });
        // 사실 서명 반환값 서명의 기대값 사실 서명 반환값 서명 일치 확인
        expect(a.signature).toBe(b.signature);
        // 사실 서명 반환값 입력의 샷 1 미포함 확인
        expect(a.input).not.toContain("shot-1");
    });

    it("중첩된 관측 객체도 정규화한다", () => {
        // 서명 시험용 사실 서명 결과 준비
        const signature = factSignature({
            severity: { value: "RECKLESS", observedAtSpeed: "NORMAL", shotIds: ["shot-3"] }
        });
        // 서명 입력의 관측결과 시점 포함 확인
        expect(signature.input).toContain("observedAtSpeed");
        // 서명 입력의 샷 3 미포함 확인
        expect(signature.input).not.toContain("shot-3");
    });

    it("경기·심판 식별자를 담은 키는 거부한다", () => {
        // 시험 동작 함수의 잘못된 입력의 예외 발생 확인
        expect(() => factSignature({ matchId: "x", severity: "RECKLESS" })).toThrow(/matchId/);
        // 시험 동작 함수의 잘못된 입력의 예외 발생 확인
        expect(() => factSignature({ refereeName: "x" })).toThrow(/refereeName/);
        // 6개 항목 목록의 각 사례 순회
        for (const key of [
            "matchId",
            "referee",
            "officialId",
            "playerName",
            "teamId",
            "kickoffDate"
        ]) {
            // 서명 키 결과의 기대값 참 일치 확인
            expect(FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key)).toBe(true);
        }
        // 서명 키 결과의 기대값 거짓 일치 확인
        expect(FORBIDDEN_SIGNATURE_KEY_PATTERN.test("severity")).toBe(false);
    });
});
