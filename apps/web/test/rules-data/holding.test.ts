import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";

describe("holding rule sources", () => {
  it.each([
    ["ifab-2025-26", "178", "110", "70", "125", "129", "115"],
    ["ifab-2026-27", "200", "116", "74", "131", "135", "121"],
  ])("pins holding and restart references to the %s edition", (id, definition, offence, advantage, beneficiary, penalty, continued) => {
    const rules = ruleSet(id)!;
    for (const [concept, page] of [
      ["LAW_12_HOLDING_DEFINITION", definition], ["LAW_12_HOLDING_OFFENCE", offence],
      ["LAW_5_ADVANTAGE", advantage], ["LAW_13_BENEFICIARY", beneficiary],
      ["LAW_14_PENALTY", penalty], ["LAW_12_CONTINUING_HOLDING", continued],
    ] as const) {
      const citations = rules.cite(concept);
      expect(citations.length).toBeGreaterThan(0);
      expect(citations[0]).toMatchObject({ sourcePage: page, edition: id.slice(5) });
      expect(citations[0]?.ruleContentSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
