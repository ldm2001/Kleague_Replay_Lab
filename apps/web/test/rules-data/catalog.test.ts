import { createHash as digest } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KNOWN_RULE_VERSION_IDS, ruleSet } from "@replay/rule-data";

const ruleSet2025 = ruleSet("ifab-2025-26");

// 기본 판본 조회 검증
describe("ruleSet", () => {
  it("알 수 없는 판본에는 null을 반환하고 던지지 않는다", () => {
    expect(ruleSet("ifab-1998-99")).toBeNull();
    expect(KNOWN_RULE_VERSION_IDS).toContain("ifab-2025-26");
  });

  it("모든 인용이 자기 출처를 전부 갖는다", () => {
    expect(ruleSet2025).not.toBeNull();
    const citations = [
      ...ruleSet2025!.cite("LAW_17_CORNER_PROCEDURE"),
      ...ruleSet2025!.cite("LAW_11_DIRECT_RESTART_OFFSIDE"),
      ...ruleSet2025!.cite("LAW_12_DIRECT_FREE_KICK"),
      ...ruleSet2025!.cite("LAW_12_DISCIPLINE"),
      ...ruleSet2025!.cite("VAR_REVIEWABLE_CATEGORIES"),
      ...ruleSet2025!.cite("VAR_TIME_WINDOW"),
      ...ruleSet2025!.cite("VAR_THRESHOLD"),
      ...ruleSet2025!.cite("VAR_REVIEW_PROCESS"),
    ];
    expect(citations.length).toBeGreaterThan(0);
    for (const citation of citations) {
      expect(citation.authority).toBe("IFAB");
      expect(citation.edition).toBe("2025-26");
      expect(citation.ruleId).toMatch(/^ifab-2025-26-/);
      expect(citation.quoteSnapshot.length).toBeGreaterThan(0);
      expect(citation.ruleContentSha256).toBe(
        digest("sha256").update(citation.quoteSnapshot, "utf8").digest("hex"),
      );
    }
  });

  it("2025/26의 검토 가능 범주는 네 개이고 2차 경고는 빠져 있다", () => {
    const categories = ruleSet2025!.varCategories();
    expect(categories.map((category) => category.id)).toEqual([
      "GOAL_NO_GOAL",
      "PENALTY_NO_PENALTY",
      "RED_CARD",
      "MISTAKEN_IDENTITY",
    ]);
    const redCard = categories.find((category) => category.id === "RED_CARD");
    expect(redCard?.appliesTo).toEqual(["CARD_SHOWN", "SENDING_OFF_NOT_GIVEN"]);
    expect(redCard?.appliesTo).not.toContain("SECOND_CAUTION");
    expect(categories.every((category) => category.requiresCompetitionOption === null)).toBe(true);
  });

  it("재개 예외 목록은 데이터가 소유한다", () => {
    expect(ruleSet2025!.timeWindowExceptions()).toEqual({
      mistakenIdentity: true,
      sendOffCategories: ["VIOLENT_CONDUCT", "BITING_OR_SPITTING", "OFFENSIVE_LANGUAGE_OR_ACTION"],
    });
  });

  it("확인되지 않은 계층 충돌을 지어내지 않는다", () => {
    expect(ruleSet2025!.layerConflicts()).toEqual([]);
  });

  it("반환된 RuleSet은 동결되어 있고 호출마다 같은 값을 준다", () => {
    const again = ruleSet("ifab-2025-26");
    expect(again).toBe(ruleSet2025);
    expect(Object.isFrozen(ruleSet2025)).toBe(true);
    expect(Object.isFrozen(ruleSet2025!.varCategories())).toBe(true);
  });
});

// 판본 차이 검증
describe("판본 차이", () => {
  const ruleSet2026 = ruleSet("ifab-2026-27");

  it("2026/27은 다섯 범주이고 코너킥에 대회 채택 옵션이 붙어 있다", () => {
    const categories = ruleSet2026!.varCategories();
    expect(categories.map((category) => category.id)).toEqual([
      "GOAL_NO_GOAL",
      "PENALTY_NO_PENALTY",
      "RED_CARD",
      "MISTAKEN_IDENTITY",
      "CORNER_KICK",
    ]);
    const corner = categories.find((category) => category.id === "CORNER_KICK");
    expect(corner?.requiresCompetitionOption).toBe("corner_kick_review");
    expect(corner?.appliesTo).toEqual(["CORNER_KICK_AWARDED"]);
  });

  it("2차 경고는 새 범주가 아니라 퇴장 범주의 적용 대상 확장이다", () => {
    const redCard2026 = ruleSet2026!.varCategories().find((category) => category.id === "RED_CARD");
    expect(redCard2026?.appliesTo).toEqual(["CARD_SHOWN", "SENDING_OFF_NOT_GIVEN", "SECOND_CAUTION"]);
    expect(redCard2026?.requiresCompetitionOption).toBeNull();
  });

  it("두 판본의 인용은 판본 문자열까지 서로 다르다", () => {
    const older = ruleSet2025!.cite("LAW_12_DIRECT_FREE_KICK")[0]!;
    const newer = ruleSet2026!.cite("LAW_12_DIRECT_FREE_KICK")[0]!;
    expect(older.edition).toBe("2025-26");
    expect(newer.edition).toBe("2026-27");
    expect(older.ruleId).not.toBe(newer.ruleId);
    expect(older.sourcePage).toBe("109");
    expect(newer.sourcePage).toBe("115");
    expect(older.sourceUrl).toBe("https://downloads.theifab.com/downloads/laws-of-the-game-2025-26-single-pages?l=en");
    expect(newer.sourceUrl).toBe("https://downloads.theifab.com/downloads/laws-of-the-game-202627-single-pages?l=en");
    expect(ruleSet2025!.cite("VAR_THRESHOLD")[0]!.sourceUrl).toBe(older.sourceUrl);
    expect(ruleSet2026!.cite("VAR_THRESHOLD")[0]!.sourceUrl).toBe(newer.sourceUrl);
  });

  it("재개 예외는 두 판본에서 같다", () => {
    expect(ruleSet2026!.timeWindowExceptions()).toEqual(ruleSet2025!.timeWindowExceptions());
  });

  it("코너킥 절차와 직접 수신 예외는 확인된 판본별 원문 페이지를 가리킨다", () => {
    const corner2025 = ruleSet2025!.cite("LAW_17_CORNER_PROCEDURE")[0]!;
    const corner2026 = ruleSet2026!.cite("LAW_17_CORNER_PROCEDURE")[0]!;
    const offside2025 = ruleSet2025!.cite("LAW_11_DIRECT_RESTART_OFFSIDE")[0]!;
    const offside2026 = ruleSet2026!.cite("LAW_11_DIRECT_RESTART_OFFSIDE")[0]!;
    expect(corner2025.sourcePage).toBe("143");
    expect(corner2026.sourcePage).toBe("149");
    expect(offside2025.sourcePage).toBe("105");
    expect(offside2026.sourcePage).toBe("111");
    expect(corner2025.quoteSnapshot).toBe(corner2026.quoteSnapshot);
    expect(offside2025.quoteSnapshot).toBe(offside2026.quoteSnapshot);
    expect(corner2025.quoteSnapshot).toMatch(/^규정 요약:/);
    expect(offside2025.quoteSnapshot).toContain("직접");
  });
});
