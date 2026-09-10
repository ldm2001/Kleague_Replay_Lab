import { describe, expect, it } from "vitest";
import { competitionRules } from "@replay/rule-data";
import { evaluateVarScope } from "../../src/rules/engine/var/scope";

const cue = { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000,
  endMs: 1400, evidenceTimestampsMs: [1000, 1200, 1400] };
const source = { sourceSha256: "ab".repeat(32), matchKey: "verified-test-match", competition: "K리그2" as const,
  season: "2026", verification: "REGISTERED_SOURCE_HASH" as const, sourceUrls: ["https://example.test/match"] };
const input = { broadcastCue: cue, startMs: 0, endMs: 2000,
  evidence: [{ evidenceId: "clip", kind: "CLIP" as const, startMs: 0, endMs: 2000 }], source };

describe("competition VAR scope", () => {
  it.each([['K리그1', '2025'], ['K리그2', '2025'], ['K리그1', '2026'], ['K리그2', '2026']] as const)(
    "answers the category question using exactly %s %s and no fabricated foul decision", (competition, season) => {
      const book = competitionRules(competition, season)!;
      const result = evaluateVarScope({ ...input, source: { ...source, competition, season } }, book)!;
      expect(result).toMatchObject({ kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED",
        included: true, competition, season, ruleVersionId: book.versionId,
        provenance: { origin: "VIDEO_CUE_AND_COMPETITION_RULES", sourceSha256: source.sourceSha256,
          ruleDocumentSha256: book.source.documentSha256, cueStartMs: 1000, cueEndMs: 1400 } });
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.citations.every((item) => item.authority === "KLEAGUE" && item.edition === season && item.ruleId.startsWith(book.versionId))).toBe(true);
      expect(result.notAssessed).toContain("VAR_CHECK_PERFORMED");
      expect(result.notAssessed).toContain("REFEREE_DECISION_CORRECTNESS");
      expect(result.notAssessed).toContain("IFAB_EDITION_ADOPTION");
      expect(result).not.toHaveProperty("decision");
      expect(result).not.toHaveProperty("intervention");
      expect(result.explanation).toContain("제공된");
    });

  it("does not infer a match, invent missing evidence or accept a renamed goal decision", () => {
    const book = competitionRules("K리그2", "2026");
    expect(evaluateVarScope({ ...input, source: null }, book)).toBeNull();
    expect(evaluateVarScope(input, null)).toBeNull();
    expect(evaluateVarScope({ ...input, evidence: [] }, book)).toBeNull();
    expect(evaluateVarScope({ ...input, evidence: [{ ...input.evidence[0]!, kind: "FRAME" }] }, book)).toBeNull();
    expect(evaluateVarScope({ ...input, evidence: [{ ...input.evidence[0]!, endMs: 1200 }] }, book)).toBeNull();
    expect(evaluateVarScope({ ...input, broadcastCue: { ...cue, kind: "GOAL_AWARDED" } }, book)).toBeNull();
    expect(evaluateVarScope({ ...input, broadcastCue: { ...cue, endMs: 3000 } }, book)).toBeNull();
  });

  it("refuses league, season, provenance and source-citation mismatches", () => {
    const book = competitionRules("K리그2", "2026")!;
    expect(evaluateVarScope(input, competitionRules("K리그1", "2026"))).toBeNull();
    expect(evaluateVarScope(input, competitionRules("K리그2", "2025"))).toBeNull();
    expect(evaluateVarScope({ ...input, source: { ...source, verification: "USER" } as never }, book)).toBeNull();
    expect(evaluateVarScope(input, { ...book, cite: () => [] })).toBeNull();
  });
});
