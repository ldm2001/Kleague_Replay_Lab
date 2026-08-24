import type { PushFacts } from "@replay/shared-types";
import { observed } from "@replay/shared-types";
import { loadRuleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { evaluatePush } from "../src/index.js";

const rules = loadRuleSet("ifab-2025-26")!;

const base: PushFacts = {
  contactDetected: observed(true, "NORMAL", ["shot-1"]),
  severity: observed("RECKLESS", "NORMAL", ["shot-1"]),
  opponentDisplacement: observed("clear", "NORMAL", ["shot-1"]),
  insidePenaltyArea: observed(false, "NORMAL", ["shot-1"]),
  cameraSufficiency: "HIGH",
};

describe("evaluatePush", () => {
  it("사실값이 막혀도 규정 설명은 그대로 나온다", () => {
    const result = evaluatePush({ ...base, cameraSufficiency: "LOW" }, rules);
    expect(result.decision).toBe("INCONCLUSIVE");
    expect(result.accounts).not.toHaveLength(0);
    expect(result.accounts[0]!.requires).not.toHaveLength(0);
    expect(result.blockedFrom).not.toHaveLength(0);
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
  });

  it("밀기 경로에서는 VAR 판단을 계산하지 않는다", () => {
    expect(evaluatePush(base, rules).varAssessment).toBeNull();
  });

  it("인용은 ruleId 기준으로 중복 없이 모인다", () => {
    const ids = evaluatePush(base, rules).citations.map((citation) => citation.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("서명은 결정적이고 shotIds에 흔들리지 않는다", () => {
    const first = evaluatePush(base, rules);
    const second = evaluatePush(
      { ...base, contactDetected: observed(true, "NORMAL", ["shot-77"]) },
      rules,
    );
    expect(first.factSignature).toBe(second.factSignature);
    expect(first.factSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("관측 판정이 없으므로 비교 결과는 UNDETERMINED다", () => {
    expect(evaluatePush(base, rules).decisionMatch).toBe("UNDETERMINED");
  });

  it("파울 경로는 강도·재개·징계를 함께 채운다", () => {
    const result = evaluatePush(
      { ...base, insidePenaltyArea: observed(true, "NORMAL", ["shot-1"]) },
      rules,
    );
    expect(result.decision).toBe("FOUL");
    expect(result.severity).toBe("RECKLESS");
    expect(result.restart).toBe("PENALTY_KICK");
    expect(result.disciplinary).toBe("CAUTION");
    expect(result.inconclusiveReason).toBeNull();
  });
});
