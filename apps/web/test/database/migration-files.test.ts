import { describe, expect, it } from "vitest";
import { loadMigrations } from "../../../../scripts/database/migrations.mjs";

describe("migration discovery", () => {
  it("loads every SQL migration in filename order with a checksum", async () => {
    const migrations = await loadMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual([
      "0000_initial_schema",
      "0001_ttl_expiry_policy",
      "0002_append_only_records",
      "0003_upload_intents",
      "0004_upload_intent_policy",
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.sql).toContain("CREATE TABLE analyses");
  });
});
