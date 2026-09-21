import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INCONCLUSIVE_REASONS, VAR_INTERVENTIONS } from "@replay/shared-types";
import { inconclusiveReason, varIntervention } from "../../src/database/schema/enums";

describe("judgment contract additive migration", () => {
  it("preserves legacy VAR outcomes alongside computed states", () => {
    expect(VAR_INTERVENTIONS).toEqual(expect.arrayContaining([
      "OVERTURNED", "CONFIRMED", "NO_INTERVENTION", "INTERVENTION_RECOMMENDED", "UNDETERMINED",
    ]));
    expect(varIntervention.enumValues).toEqual(VAR_INTERVENTIONS);
  });

  it("records missing facts and unsupported context without a false negative", () => {
    expect(INCONCLUSIVE_REASONS).toEqual(expect.arrayContaining(["FACTS_UNDETERMINED", "CONTEXT_UNSUPPORTED"]));
    expect(inconclusiveReason.enumValues).toEqual(INCONCLUSIVE_REASONS);
  });

  it("adds enum values and allows unknown replay without rewriting history", () => {
    const sql = readFileSync(new URL("../../src/database/migrations/0019_judgment_contract.sql", import.meta.url), "utf8");
    for (const [type, values] of [
      ["var_intervention", ["INTERVENTION_RECOMMENDED", "UNDETERMINED"]],
      ["inconclusive_reason", ["FACTS_UNDETERMINED", "CONTEXT_UNSUPPORTED"]],
    ] as const) {
      for (const value of values) expect(sql).toContain(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS '${value}'`);
    }
    expect(sql).toMatch(/ALTER TABLE shots ALTER COLUMN is_replay DROP NOT NULL/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP TYPE)\b/i);
  });
});
