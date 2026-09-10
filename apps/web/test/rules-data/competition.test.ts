import { createHash as digest } from "node:crypto";
import { describe, expect, it } from "vitest";
import { combineCompetitionRules, competitionRules, ruleSet } from "@replay/rule-data";
import { CONCEPT_KEYS } from "@replay/shared-types";

const ARCHIVE = "https://web.archive.org/web/20250208231838/https://www.kleague.com/about/competition.do";
const CURRENT = "https://www.kleague.com/about/competition.do";
const BOOKS = [
  {
    competition: "K리그1", season: "2025", versionId: "kleague1-2025",
    sha: "e1db5c91b9b702f54f3b9a224b1713fdc6576c655cc18ba2b795b20f62055b0a",
    scopePage: "5", processPage: "6", fallback: "6",
  },
  {
    competition: "K리그2", season: "2025", versionId: "kleague2-2025",
    sha: "4f1425ff965967eed5883ad3b722f4e5a043b68aaf4c7f7e3fb161b8e84402f1",
    scopePage: "5", processPage: "6", fallback: "6",
  },
  {
    competition: "K리그1", season: "2026", versionId: "kleague1-2026",
    sha: "81b53c6ad28597a614f32c2fdef2f0d6615c9862340a71e5bfe3fb01fb7278e9",
    scopePage: "6", processPage: "6", fallback: "7",
  },
  {
    competition: "K리그2", season: "2026", versionId: "kleague2-2026",
    sha: "932b9f5d9f94b319e46dc17d985e32a1394f1ad05e4537a5aedc969f7ac47b0a",
    scopePage: "6", processPage: "7", fallback: "7",
  },
] as const;

describe("competitionRules", () => {
  it("대회와 시즌을 명시적으로 조회하는 레지스트리를 제공한다", () => {
    expect(competitionRules).toBeTypeOf("function");
  });

  it.each(BOOKS)("$versionId 원문 정체성과 출처를 구분한다", (expected) => {
    const book = competitionRules(expected.competition, expected.season)!;
    expect(book).not.toBeNull();
    expect(book.versionId).toBe(expected.versionId);
    expect(book.competition).toBe(expected.competition);
    expect(book.season).toBe(expected.season);
    expect(book.title).toBe(`하나은행 ${expected.competition} ${expected.season} 대회요강`);
    expect(book.source).toEqual({
      url: expected.season === "2025" ? ARCHIVE : CURRENT,
      documentSha256: expected.sha,
      snapshotDate: expected.season === "2025" ? "2025-02-08" : null,
      localPath: `rules/kleague/${expected.season}/${expected.versionId.split("-")[0]}/competition-regulations.pdf`,
    });
  });

  it.each([
    ["K리그1", "2024"], ["K리그2", "2027"], ["K리그3", "2026"],
    ["kleague1", "2026"], ["K리그1", "2025-26"], ["", ""],
  ])("알 수 없는 대회·시즌 %s/%s를 다른 판본으로 대체하지 않는다", (competition, season) => {
    expect(competitionRules(competition, season)).toBeNull();
  });

  it.each(BOOKS)("$versionId의 명시된 네 범주를 원문 명칭과 함께 보존한다", ({ competition, season }) => {
    expect(competitionRules(competition, season)!.scopeCategories).toEqual([
      { topic: "GOAL_RELATED", sourceLabel: "득점 상황", law: "25", section: "1.1" },
      { topic: "PENALTY_RELATED", sourceLabel: "PK(Penalty Kick) 상황", law: "25", section: "1.2" },
      { topic: "SENDING_OFF_RELATED", sourceLabel: "퇴장 상황", law: "25", section: "1.3" },
      { topic: "DISCIPLINARY_ERROR", sourceLabel: "징계조치 오류", law: "25", section: "1.4" },
    ]);
  });

  it.each(BOOKS)("$versionId 인용은 자기 대회·시즌·페이지와 내용 해시를 갖는다", (expected) => {
    const book = competitionRules(expected.competition, expected.season)!;
    const scope = book.cite("VAR_REVIEWABLE_CATEGORIES");
    const process = book.cite("VAR_REVIEW_PROCESS");
    expect(scope.some((citation) => citation.section === "1")).toBe(true);
    expect(scope.every((citation) => citation.sourcePage === expected.scopePage)).toBe(true);
    expect(process.some((citation) => citation.section === expected.fallback)).toBe(true);
    expect(process.every((citation) => citation.sourcePage === expected.processPage)).toBe(true);
    for (const citation of [...scope, ...process]) {
      expect(citation.ruleId).toMatch(new RegExp(`^${expected.versionId}-`));
      expect(citation.authority).toBe("KLEAGUE");
      expect(citation.edition).toBe(expected.season);
      expect(citation.law).toBe("25");
      expect(citation.sourceUrl).toBe(book.source.url);
      expect(citation.quoteSnapshot).toMatch(/^규정 요약:/);
      expect(citation.ruleContentSha256).toBe(
        digest("sha256").update(citation.quoteSnapshot, "utf8").digest("hex"),
      );
      expect(citation.ruleContentSha256).not.toBe(book.source.documentSha256);
    }
    for (const concept of CONCEPT_KEYS.filter((key) => !["VAR_REVIEWABLE_CATEGORIES", "VAR_REVIEW_PROCESS"].includes(key))) {
      expect(book.cite(concept)).toEqual([]);
    }
  });

  it("동일 시즌 두 리그의 인용 ID와 원문 해시를 서로 바꾸지 않는다", () => {
    for (const season of ["2025", "2026"]) {
      const first = competitionRules("K리그1", season)!;
      const second = competitionRules("K리그2", season)!;
      expect(first.source.documentSha256).not.toBe(second.source.documentSha256);
      const ids = new Set(first.cite("VAR_REVIEWABLE_CATEGORIES").map((citation) => citation.ruleId));
      expect(second.cite("VAR_REVIEWABLE_CATEGORIES").every((citation) => !ids.has(citation.ruleId))).toBe(true);
    }
  });

  it.each(["K리그1", "K리그2"])("%s 장내 방송은 2025년 미명시와 2026년 OFR 한정을 구분한다", (competition) => {
    const older = competitionRules(competition, "2025")!;
    const newer = competitionRules(competition, "2026")!;
    expect(older.publicAnnouncement).toBe("NOT_STATED");
    expect(newer.publicAnnouncement).toBe("OFR_ONLY");
    expect(older.cite("VAR_REVIEW_PROCESS")).toHaveLength(1);
    expect(newer.cite("VAR_REVIEW_PROCESS").find((citation) => citation.section === "6")?.quoteSnapshot).toContain("OFR");
  });

  it("중첩 데이터와 인용을 동결하고 반환 배열 변경은 다음 조회에 영향을 주지 않는다", () => {
    const book = competitionRules("K리그1", "2026")!;
    expect(competitionRules("K리그1", "2026")).toBe(book);
    expect(Object.isFrozen(book)).toBe(true);
    expect(Object.isFrozen(book.source)).toBe(true);
    expect(Object.isFrozen(book.scopeCategories)).toBe(true);
    expect(book.scopeCategories.every(Object.isFrozen)).toBe(true);
    const citations = book.cite("VAR_REVIEWABLE_CATEGORIES");
    expect(citations.every(Object.isFrozen)).toBe(true);
    citations.splice(0, citations.length);
    expect(book.cite("VAR_REVIEWABLE_CATEGORIES").length).toBeGreaterThan(0);
  });
});

describe("combineCompetitionRules", () => {
  it.each([
    { competition: "K리그3", season: "2026", ifabVersionId: "ifab-2026-27" },
    { competition: "K리그1", season: "2027", ifabVersionId: "ifab-2026-27" },
    { competition: "K리그1", season: "2026", ifabVersionId: "ifab-1998-99" },
    { competition: "K리그1", season: "2026", ifabVersionId: "" },
  ])("미확인 구성요소를 추정하지 않는다: $competition/$season/$ifabVersionId", (selection) => {
    expect(combineCompetitionRules(selection)).toBeNull();
  });

  it.each(BOOKS)("$versionId 조합은 근거 있는 개념에만 대회 인용을 덧붙인다", ({ competition, season }) => {
    const base = ruleSet("ifab-2026-27")!;
    const book = competitionRules(competition, season)!;
    const combined = combineCompetitionRules({ competition, season, ifabVersionId: "ifab-2026-27" })!;
    for (const concept of CONCEPT_KEYS) {
      expect(combined.cite(concept)).toEqual([...base.cite(concept), ...book.cite(concept)]);
    }
    expect(combined.layerConflicts()).toEqual(base.layerConflicts());
    expect(Object.isFrozen(combined)).toBe(true);
  });

  it.each(BOOKS)("$versionId 네 범주 외 독립 코너 검토를 제한하고 IFAB 원본은 보존한다", ({ competition, season }) => {
    const base = ruleSet("ifab-2026-27")!;
    const combined = combineCompetitionRules({ competition, season, ifabVersionId: "ifab-2026-27" })!;
    expect(combined.varCategories().map((category) => category.id)).toEqual([
      "GOAL_NO_GOAL", "PENALTY_NO_PENALTY", "RED_CARD", "MISTAKEN_IDENTITY",
    ]);
    expect(base.varCategories().map((category) => category.id)).toContain("CORNER_KICK");
    expect(Object.isFrozen(combined.varCategories())).toBe(true);
    expect(combined.varCategories().every(Object.isFrozen)).toBe(true);
  });

  it("시즌으로 IFAB 판본을 추정하지 않고 지정 판본의 두 번째 경고와 시간 창 세부 규칙을 유지한다", () => {
    for (const ifabVersionId of ["ifab-2025-26", "ifab-2026-27"]) {
      const base = ruleSet(ifabVersionId)!;
      const combined = combineCompetitionRules({ competition: "K리그1", season: "2026", ifabVersionId })!;
      expect(combined.varCategories().find((category) => category.id === "RED_CARD")).toEqual(
        base.varCategories().find((category) => category.id === "RED_CARD"),
      );
      expect(combined.timeWindowExceptions()).toEqual(base.timeWindowExceptions());
    }
  });
});
