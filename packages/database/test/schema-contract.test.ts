import { describe, expect, it } from "vitest";
import { schema } from "../src/index.js";

describe("database schema public contract", () => {
  it("exports every MVP table", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "analyses",
      "anonymousSessions",
      "clubs",
      "competitionRuleVersions",
      "decisionResults",
      "evidenceAssets",
      "factRevisionShots",
      "factRevisions",
      "idempotencyRecords",
      "incidentCandidates",
      "matches",
      "officialVerdicts",
      "processingJobs",
      "rules",
      "shots",
      "videoAssets",
    ]);
  });

  it("keeps fact-shot evidence and idempotency as relational tables", () => {
    expect(schema.factRevisionShots).toBeDefined();
    expect(schema.idempotencyRecords).toBeDefined();
    expect(schema.analyses).toBeDefined();
    expect(schema.processingJobs).toBeDefined();
  });
});
