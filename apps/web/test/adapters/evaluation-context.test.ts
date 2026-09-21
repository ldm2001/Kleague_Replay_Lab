import { describe, expect, it } from "vitest";
import { EvaluationStore } from "../../src/adapters/evaluation-store";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { observation } from "@replay/shared-types";
import { context } from "../fixtures/push-context";

describe("evaluation context evidence ownership", () => {
  it("rejects a context-only shot from another analysis before saving a revision", async () => {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const shot = "44444444-4444-4444-8444-444444444444";
    const repository = new EvaluationStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (sql: SQL) => {
        const query = new PgDialect().sqlToQuery(sql);
        queries.push(query);
        if (query.sql.includes("select candidate.id")) return [{ id: "candidate", current_fact_revision_id: null }];
        if (query.sql.includes("coalesce(max(revision)")) return [{ revision: 1 }];
        if (query.sql.includes("select count(*)")) return [{ count: 0 }];
        if (query.sql.includes("insert into fact_revisions")) return [{ id: "revision", revision: 1 }];
        return [];
      },
    }) } } as never);
    const result = await repository.patch({
      anonymousSessionId: "session", analysisId: "analysis", candidateId: "candidate", expectedFactRevisionId: null,
      keyHash: new Uint8Array(32), requestHash: new Uint8Array(32), now: "2026-09-21T00:00:00Z",
      facts: {
        push: { contactDetected: observation(true, "NORMAL", []), severity: observation("CARELESS", "NORMAL", []),
          opponentDisplacement: observation("none", "NORMAL", []), insidePenaltyArea: observation(false, "NORMAL", []),
          cameraSufficiency: "HIGH", context: { ...context(), ballInPlay: observation(true, "NORMAL", [shot]) } },
        variable: { reviewScenario: "OTHER", restartOccurred: false, sendOffCategory: "NONE", mistakenIdentity: false,
          decisionNature: "FACTUAL", errorMagnitude: "UNDETERMINED", seriousMissedIncident: false },
        observed: { restartType: "UNKNOWN", restartBeneficiary: "UNKNOWN", card: null, goalDecision: "UNKNOWN", source: "USER_INPUT" },
      },
    });
    expect(result).toEqual({ kind: "NOT_FOUND" });
    expect(queries.find((query) => query.sql.includes("select count(*)"))?.params).toContain(shot);
    expect(queries.some((query) => query.sql.includes("insert into fact_revisions"))).toBe(false);
  });
});
