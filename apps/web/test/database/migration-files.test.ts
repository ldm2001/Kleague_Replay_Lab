import { describe, expect, it } from "vitest";
import { migrations } from "../../../../scripts/database/migrations.mjs";

describe("migration discovery", () => {
  it("loads every SQL migration in filename order with a checksum", async () => {
    const list = await migrations();

    expect(list.map((migration) => migration.name)).toEqual([
      "0000_initial_schema",
      "0001_ttl_expiry_policy",
      "0002_append_only_records",
      "0003_upload_intents",
      "0004_upload_intent_policy",
      "0005_analysis_status",
      "0006_job_progress",
      "0007_analysis_output",
      "0008_candidate_output",
    ]);
    expect(list[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(list[0]?.sql).toContain("CREATE TABLE analyses");
    const status = list.find((migration) => migration.name === "0005_analysis_status");
    expect(status?.sql).toContain("analyses_status_check");
    expect(status?.sql).toContain("APPLYING_RULES");
    const output = list.find((migration) => migration.name === "0007_analysis_output");
    expect(output?.sql).toContain("limitations");
    const candidate = list.find((migration) => migration.name === "0008_candidate_output");
    expect(candidate?.sql).toContain("anchor_ms");
  });
});
