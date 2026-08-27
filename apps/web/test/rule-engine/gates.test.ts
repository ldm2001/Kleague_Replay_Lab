import type { PushFacts } from "@replay/shared-types";
import { observation } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { pushGates, discipline } from "@replay/rule-engine";

const rules = ruleSet("ifab-2025-26")!;

const base: PushFacts = {
  contactDetected: observation(true, "NORMAL", ["shot-1"]),
  severity: observation("RECKLESS", "NORMAL", ["shot-1"]),
  opponentDisplacement: observation("clear", "NORMAL", ["shot-1"]),
  insidePenaltyArea: observation(false, "NORMAL", ["shot-1"]),
  cameraSufficiency: "HIGH",
};

describe("pushGates", () => {
  it("각도가 부족하면 어떤 사실값이 들어와도 INCONCLUSIVE로 고정된다", () => {
    const verdict = pushGates({ ...base, cameraSufficiency: "LOW" }, rules);
    expect(verdict.decision).toBe("INCONCLUSIVE");
    expect(verdict.inconclusiveReason).toBe("CAMERA_INSUFFICIENT");
    expect(verdict.severity).toBeNull();
    expect(verdict.confidence).toBe("LOW");
  });

  it("접촉이 없으면 파울이 아니며 속도 게이트를 거치지 않는다", () => {
    const verdict = pushGates(
      {
        ...base,
        contactDetected: observation(false, "SLOW", ["shot-2"]),
        severity: observation("uncertain", "SLOW", ["shot-2"]),
      },
      rules,
    );
    expect(verdict.decision).toBe("NO_FOUL");
    expect(verdict.restart).toBe("PLAY_CONTINUED");
  });

  it("강도를 슬로우모션에서만 봤으면 판정하지 않고 근거로 VAR 프로토콜을 든다", () => {
    const verdict = pushGates(
      { ...base, severity: observation("EXCESSIVE_FORCE", "SLOW", ["shot-2"]) },
      rules,
    );
    expect(verdict.decision).toBe("INCONCLUSIVE");
    expect(verdict.inconclusiveReason).toBe("SLOW_MOTION_ONLY");
    expect(verdict.citations.some((citation) => citation.law === "VAR")).toBe(true);
  });

  it("관측 속도가 UNKNOWN인 강도도 승인하지 않는다", () => {
    const verdict = pushGates(
      { ...base, severity: observation("RECKLESS", "UNKNOWN", []) },
      rules,
    );
    expect(verdict.inconclusiveReason).toBe("SLOW_MOTION_ONLY");
  });

  it("밀림이 possible이면 파울로 단정하지 않는다", () => {
    const verdict = pushGates(
      { ...base, opponentDisplacement: observation("possible", "NORMAL", ["shot-1"]) },
      rules,
    );
    expect(verdict.decision).toBe("INCONCLUSIVE");
    expect(verdict.inconclusiveReason).toBe("SEVERITY_UNDETERMINED");
  });

  it("밀림 없는 부주의 접촉은 정상적인 몸싸움이다", () => {
    const verdict = pushGates(
      {
        ...base,
        severity: observation("CARELESS", "NORMAL", ["shot-1"]),
        opponentDisplacement: observation("none", "NORMAL", ["shot-1"]),
      },
      rules,
    );
    expect(verdict.decision).toBe("NORMAL_CONTACT");
    expect(verdict.restart).toBe("PLAY_CONTINUED");
    expect(verdict.disciplinary).toBe("NONE");
  });

  it("페널티지역 안팎이 재개 방식을 가른다", () => {
    expect(pushGates(base, rules).restart).toBe("DIRECT_FREE_KICK");
    expect(
      pushGates({ ...base, insidePenaltyArea: observation(true, "NORMAL", ["shot-1"]) }, rules)
        .restart,
    ).toBe("PENALTY_KICK");
  });

  it("강도가 징계 등급을 정한다", () => {
    expect(discipline("CARELESS")).toBe("NONE");
    expect(discipline("RECKLESS")).toBe("CAUTION");
    expect(discipline("EXCESSIVE_FORCE")).toBe("SEND_OFF");
    const sendOff = pushGates(
      { ...base, severity: observation("EXCESSIVE_FORCE", "NORMAL", ["shot-1"]) },
      rules,
    );
    expect(sendOff.decision).toBe("FOUL");
    expect(sendOff.disciplinary).toBe("SEND_OFF");
    expect(sendOff.severity).toBe("EXCESSIVE_FORCE");
  });

  it("어떤 경로로 나가도 인용이 최소 하나 붙는다", () => {
    const inputs: PushFacts[] = [
      { ...base, cameraSufficiency: "LOW" },
      { ...base, contactDetected: observation(false, "NORMAL", ["shot-1"]) },
      { ...base, severity: observation("RECKLESS", "SLOW", ["shot-2"]) },
      { ...base, severity: observation("uncertain", "NORMAL", ["shot-1"]) },
      { ...base, severity: observation("CARELESS", "NORMAL", ["shot-1"]),
        opponentDisplacement: observation("none", "NORMAL", ["shot-1"]) },
      base,
    ];
    for (const facts of inputs) {
      expect(pushGates(facts, rules).citations.length).toBeGreaterThanOrEqual(1);
    }
  });
});
