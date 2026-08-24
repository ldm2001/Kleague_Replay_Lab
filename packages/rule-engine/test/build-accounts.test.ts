import type { PushFacts } from "@replay/shared-types";
import { observed } from "@replay/shared-types";
import { loadRuleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { buildPushAccounts } from "../src/interpreter/build-accounts.js";

const rules = loadRuleSet("ifab-2025-26")!;

const establishedFacts: PushFacts = {
  contactDetected: observed(true, "NORMAL", ["shot-1"]),
  severity: observed("RECKLESS", "NORMAL", ["shot-1"]),
  opponentDisplacement: observed("clear", "NORMAL", ["shot-1"]),
  insidePenaltyArea: observed(false, "NORMAL", ["shot-1"]),
  cameraSufficiency: "HIGH",
};

const requirementFor = (facts: PushFacts, name: string) =>
  buildPushAccounts(facts, rules).accounts[0]!.requires.find((entry) => entry.fact === name)!;

describe("buildPushAccounts", () => {
  it("사실값이 전부 서면 blockedFrom이 비고 징계 조항까지 내려간다", () => {
    const view = buildPushAccounts(establishedFacts, rules);
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]!.authority).toBe("IFAB");
    expect(view.blockedFrom).toEqual([]);
    expect(view.narrowedTo.map((citation) => citation.section)).toContain("1");
    expect(view.narrowedTo.length).toBeGreaterThanOrEqual(2);
  });

  it("각도가 부족해도 accounts는 비지 않고 요구 사실이 그대로 나열된다", () => {
    const view = buildPushAccounts({ ...establishedFacts, cameraSufficiency: "LOW" }, rules);
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]!.citations.length).toBeGreaterThan(0);
    expect(view.accounts[0]!.requires.map((entry) => entry.fact)).toEqual([
      "contactDetected",
      "severity",
      "opponentDisplacement",
      "insidePenaltyArea",
    ]);
    expect(view.blockedFrom).toHaveLength(4);
    expect(view.blockedFrom.every((entry) => entry.blockedBy === "CAMERA")).toBe(true);
  });

  it("슬로우모션에서만 본 강도는 SPEED로 막힌다", () => {
    const facts: PushFacts = {
      ...establishedFacts,
      severity: observed("EXCESSIVE_FORCE", "SLOW", ["shot-2"]),
    };
    const severity = requirementFor(facts, "severity");
    expect(severity.status).toBe("UNMET");
    expect(severity.blockedBy).toBe("SPEED");
    expect(requirementFor(facts, "contactDetected").status).toBe("ESTABLISHED");
  });

  it("정상 속도로 봤지만 값을 특정 못한 경우는 blockedBy가 null이다", () => {
    const facts: PushFacts = {
      ...establishedFacts,
      severity: observed("uncertain", "NORMAL", ["shot-1"]),
    };
    const severity = requirementFor(facts, "severity");
    expect(severity.status).toBe("UNMET");
    expect(severity.blockedBy).toBeNull();
  });

  it("밀림이 possible이면 관측은 됐어도 요구 사실은 서지 않는다", () => {
    const facts: PushFacts = {
      ...establishedFacts,
      opponentDisplacement: observed("possible", "NORMAL", ["shot-1"]),
    };
    const displacement = requirementFor(facts, "opponentDisplacement");
    // 게이트가 possible에서 보류하는데 요구 사실만 서면 blockedFrom이 빈 채로
    // INCONCLUSIVE가 나간다. 게이트와 요구사항이 같은 값을 같게 봐야 한다.
    expect(displacement.status).toBe("UNMET");
    expect(displacement.blockedBy).toBeNull();
    expect(buildPushAccounts(facts, rules).blockedFrom).toHaveLength(1);
  });

  it("강도가 막히면 징계 조항으로 내려가지 못하고 narrowsTo가 그 조항을 가리킨다", () => {
    const facts: PushFacts = {
      ...establishedFacts,
      severity: observed("RECKLESS", "SLOW", ["shot-2"]),
    };
    const view = buildPushAccounts(facts, rules);
    const severity = view.accounts[0]!.requires.find((entry) => entry.fact === "severity")!;
    expect(severity.narrowsTo?.ruleId).toBe("ifab-2025-26-law-12-1-discipline");
    expect(view.narrowedTo.map((citation) => citation.ruleId)).not.toContain(
      "ifab-2025-26-law-12-1-discipline",
    );
  });

  it("확인되지 않은 계층 충돌을 만들어내지 않는다", () => {
    expect(buildPushAccounts(establishedFacts, rules).conflicts).toEqual([]);
  });
});
