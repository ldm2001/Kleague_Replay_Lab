// 사실 서명 테스트
import { describe, expect, it } from "vitest";
import { factSignature, FORBIDDEN_SIGNATURE_KEY_PATTERN } from "@replay/rule-engine";

describe("factSignature", () => {
  it("같은 입력은 항상 같은 64자리 서명을 낸다", () => {
    const first = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
    const second = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
    expect(first.signature).toBe(second.signature);
    expect(first.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("키 순서가 달라도 같은 서명을 낸다", () => {
    const a = factSignature({ severity: "RECKLESS", insidePenaltyArea: false });
    const b = factSignature({ insidePenaltyArea: false, severity: "RECKLESS" });
    expect(a.signature).toBe(b.signature);
  });

  it("값이 하나만 달라도 서명이 달라진다", () => {
    const a = factSignature({ severity: "RECKLESS" });
    const b = factSignature({ severity: "CARELESS" });
    expect(a.signature).not.toBe(b.signature);
  });

  it("shotIds는 서명에서 빠진다", () => {
    const a = factSignature({ severity: "RECKLESS", shotIds: ["shot-1"] });
    const b = factSignature({ severity: "RECKLESS", shotIds: ["shot-9", "shot-12"] });
    expect(a.signature).toBe(b.signature);
    expect(a.input).not.toContain("shot-1");
  });

  it("중첩된 관측 객체도 정규화한다", () => {
    const signature = factSignature({
      severity: { value: "RECKLESS", observedAtSpeed: "NORMAL", shotIds: ["shot-3"] },
    });
    expect(signature.input).toContain("observedAtSpeed");
    expect(signature.input).not.toContain("shot-3");
  });

  it("경기·심판 식별자를 담은 키는 거부한다", () => {
    expect(() => factSignature({ matchId: "x", severity: "RECKLESS" })).toThrow(
      /matchId/,
    );
    expect(() => factSignature({ refereeName: "x" })).toThrow(/refereeName/);
    for (const key of ["matchId", "referee", "officialId", "playerName", "teamId", "kickoffDate"]) {
      expect(FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key)).toBe(true);
    }
    expect(FORBIDDEN_SIGNATURE_KEY_PATTERN.test("severity")).toBe(false);
  });
});
