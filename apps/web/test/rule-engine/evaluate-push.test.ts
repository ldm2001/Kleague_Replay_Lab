import type { PushFacts } from "@replay/shared-types";
import { observation } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { pushResult } from "@replay/rule-engine";

const rules = ruleSet("ifab-2025-26")!;

const base: PushFacts = {
  contactDetected: observation(true, "NORMAL", ["shot-1"]),
  severity: observation("RECKLESS", "NORMAL", ["shot-1"]),
  opponentDisplacement: observation("clear", "NORMAL", ["shot-1"]),
  insidePenaltyArea: observation(false, "NORMAL", ["shot-1"]),
  cameraSufficiency: "HIGH",
};

describe("pushResult", () => {
  it("사실값이 막혀도 규정 설명은 그대로 나온다", () => {
    const result = pushResult({ ...base, cameraSufficiency: "LOW" }, rules);
    expect(result.decision).toBe("INCONCLUSIVE");
    expect(result.accounts).not.toHaveLength(0);
    expect(result.accounts[0]!.requires).not.toHaveLength(0);
    expect(result.blockedFrom).not.toHaveLength(0);
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
  });

  it("밀기 경로에서는 VAR 판단을 계산하지 않는다", () => {
    expect(pushResult(base, rules).varAssessment).toBeNull();
  });

  it("인용은 ruleId 기준으로 중복 없이 모인다", () => {
    const ids = pushResult(base, rules).citations.map((citation) => citation.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("서명은 결정적이고 shotIds에 흔들리지 않는다", () => {
    const first = pushResult(base, rules);
    const second = pushResult(
      { ...base, contactDetected: observation(true, "NORMAL", ["shot-77"]) },
      rules,
    );
    expect(first.factSignature).toBe(second.factSignature);
    expect(first.factSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("관측 판정이 없으므로 비교 결과는 UNDETERMINED다", () => {
    expect(pushResult(base, rules).decisionMatch).toBe("UNDETERMINED");
  });

  it("파울 경로는 강도·재개·징계를 함께 채운다", () => {
    const result = pushResult(
      { ...base, insidePenaltyArea: observation(true, "NORMAL", ["shot-1"]) },
      rules,
    );
    expect(result.decision).toBe("FOUL");
    expect(result.severity).toBe("RECKLESS");
    expect(result.restart).toBe("PENALTY_KICK");
    expect(result.disciplinary).toBe("CAUTION");
    expect(result.inconclusiveReason).toBeNull();
  });
});
