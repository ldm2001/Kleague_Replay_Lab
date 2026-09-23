import { createHash as digest } from "node:crypto";
import { describe, expect, it } from "vitest";
import { competitionSet, competitionRules, ruleSet } from "@replay/rule-data";
import { CONCEPT_KEYS } from "@replay/shared-types";

// 시험자료 시험용 20250208231838 대회 준비
const ARCHIVE =
    "https://web.archive.org/web/20250208231838/https://www.kleague.com/about/competition.do";
// 시험자료 시험용 대회 준비
const CURRENT = "https://www.kleague.com/about/competition.do";
// 시험자료 시험용 4개 항목 목록 준비
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
        // 대회 규정목록의 함수 자료형 확인
        expect(competitionRules).toBeTypeOf("function");
    });

    it.each(BOOKS)("$versionId 원문 정체성과 출처를 구분한다", (expected) => {
        // 규정집 시험용 대회 규정목록 결과 준비
        const book = competitionRules(expected.competition, expected.season)!;
        // 규정집의 값 존재 확인
        expect(book).not.toBeNull();
        // 규정집 버전 식별자의 기대값 기대값 버전 식별자 일치 확인
        expect(book.versionId).toBe(expected.versionId);
        // 규정집 대회의 기대값 기대값 대회 일치 확인
        expect(book.competition).toBe(expected.competition);
        // 규정집 시즌의 기대값 기대값 시즌 일치 확인
        expect(book.season).toBe(expected.season);
        // 규정집의 기대값 지정 형식 문자열 일치 확인
        expect(book.title).toBe(`하나은행 ${expected.competition} ${expected.season} 대회요강`);
        // 규정집 원본의 주소 및 해시 및 스냅샷 날짜 및 로컬자료 자료 기준 구조 일치 확인
        expect(book.source).toEqual({
            url: expected.season === "2025" ? ARCHIVE : CURRENT,
            documentSha256: expected.sha,
            snapshotDate: expected.season === "2025" ? "2025-02-08" : null,
            localPath: `rules/kleague/${expected.season}/${expected.versionId.split("-")[0]}/competition-regulations.pdf`
        });
    });

    it.each([
        ["K리그1", "2024"],
        ["K리그2", "2027"],
        ["K리그3", "2026"],
        ["kleague1", "2026"],
        ["K리그1", "2025-26"],
        ["", ""]
    ])("알 수 없는 대회·시즌 %s/%s를 다른 판본으로 대체하지 않는다", (competition, season) => {
        // 대회 규정목록 결과의 빈 값 확인
        expect(competitionRules(competition, season)).toBeNull();
    });

    it.each(BOOKS)(
        "$versionId의 명시된 네 범주를 원문 명칭과 함께 보존한다",
        ({ competition, season }) => {
            // 대회 규정목록 결과 적용범위의 4개 항목 목록 기준 구조 일치 확인
            expect(competitionRules(competition, season)!.scopeCategories).toEqual([
                { topic: "GOAL_RELATED", sourceLabel: "득점 상황", law: "25", section: "1.1" },
                {
                    topic: "PENALTY_RELATED",
                    sourceLabel: "PK(Penalty Kick) 상황",
                    law: "25",
                    section: "1.2"
                },
                {
                    topic: "SENDING_OFF_RELATED",
                    sourceLabel: "퇴장 상황",
                    law: "25",
                    section: "1.3"
                },
                {
                    topic: "DISCIPLINARY_ERROR",
                    sourceLabel: "징계조치 오류",
                    law: "25",
                    section: "1.4"
                }
            ]);
        }
    );

    it.each(BOOKS)("$versionId 인용은 자기 대회·시즌·페이지와 내용 해시를 갖는다", (expected) => {
        // 규정집 시험용 대회 규정목록 결과 준비
        const book = competitionRules(expected.competition, expected.season)!;
        // 적용범위 시험용 규정집 결과 준비
        const scope = book.cite("VAR_REVIEWABLE_CATEGORIES");
        // 실행환경 시험용 규정집 결과 준비
        const process = book.cite("VAR_REVIEW_PROCESS");
        // 적용범위 일부충족 결과의 기대값 참 일치 확인
        expect(scope.some((citation) => citation.section === "1")).toBe(true);
        // 적용범위 전체충족 결과의 기대값 참 일치 확인
        expect(scope.every((citation) => citation.sourcePage === expected.scopePage)).toBe(true);
        // 실행환경 일부충족 결과의 기대값 참 일치 확인
        expect(process.some((citation) => citation.section === expected.fallback)).toBe(true);
        // 실행환경 전체충족 결과의 기대값 참 일치 확인
        expect(process.every((citation) => citation.sourcePage === expected.processPage)).toBe(
            true
        );
        // 2개 항목 목록의 각 사례 순회
        for (const citation of [...scope, ...process]) {
            // 인용 규정 식별자의 지정 패턴 일치 확인
            expect(citation.ruleId).toMatch(new RegExp(`^${expected.versionId}-`));
            // 인용 권한의 기대값 지정 문자열 일치 확인
            expect(citation.authority).toBe("KLEAGUE");
            // 인용 판본의 기대값 기대값 시즌 일치 확인
            expect(citation.edition).toBe(expected.season);
            // 인용 조항의 기대값 25 일치 확인
            expect(citation.law).toBe("25");
            // 인용 출처주소의 기대값 규정집 원본 주소 일치 확인
            expect(citation.sourceUrl).toBe(book.source.url);
            // 인용 인용스냅샷의 지정 패턴 일치 확인
            expect(citation.quoteSnapshot).toMatch(/^규정 요약:/);
            // 인용 규정 내용 해시의 기대값 해시 결과 갱신 결과 해시 결과 일치 확인
            expect(citation.ruleContentSha256).toBe(
                digest("sha256").update(citation.quoteSnapshot, "utf8").digest("hex")
            );
            // 인용 규정 내용 해시의 기대값 규정집 원본 해시 불일치 확인
            expect(citation.ruleContentSha256).not.toBe(book.source.documentSha256);
        }
        // 키목록 필터 결과의 각 사례 순회
        for (const concept of CONCEPT_KEYS.filter(
            (key) => !["VAR_REVIEWABLE_CATEGORIES", "VAR_REVIEW_PROCESS"].includes(key)
        )) {
            // 규정집 결과의 0개 항목 목록 기준 구조 일치 확인
            expect(book.cite(concept)).toEqual([]);
        }
    });

    it("동일 시즌 두 리그의 인용 ID와 원문 해시를 서로 바꾸지 않는다", () => {
        // 2개 항목 목록의 각 사례 순회
        for (const season of ["2025", "2026"]) {
            // 첫결과 시험용 대회 규정목록 결과 준비
            const first = competitionRules("K리그1", season)!;
            // 두번째결과 시험용 대회 규정목록 결과 준비
            const second = competitionRules("K리그2", season)!;
            // 첫결과 원본 해시의 기대값 두번째결과 원본 해시 불일치 확인
            expect(first.source.documentSha256).not.toBe(second.source.documentSha256);
            // 식별자목록 시험용 집합 준비
            const ids = new Set(
                first.cite("VAR_REVIEWABLE_CATEGORIES").map((citation) => citation.ruleId)
            );
            // 두번째결과 결과 전체충족 결과의 기대값 참 일치 확인
            expect(
                second
                    .cite("VAR_REVIEWABLE_CATEGORIES")
                    .every((citation) => !ids.has(citation.ruleId))
            ).toBe(true);
        }
    });

    it.each(["K리그1", "K리그2"])(
        "%s 장내 방송은 2025년 미명시와 2026년 OFR 한정을 구분한다",
        (competition) => {
            // 이전자료 시험용 대회 규정목록 결과 준비
            const older = competitionRules(competition, "2025")!;
            // 새자료 시험용 대회 규정목록 결과 준비
            const newer = competitionRules(competition, "2026")!;
            // 결과가 명시되지 않음 상태로 유지됨 확인
            expect(older.publicAnnouncement).toBe("NOT_STATED");
            // 새자료 공개의 기대값 지정 문자열 일치 확인
            expect(newer.publicAnnouncement).toBe("OFR_ONLY");
            // 이전자료 결과의 항목 수 1 확인
            expect(older.cite("VAR_REVIEW_PROCESS")).toHaveLength(1);
            // 새자료 결과 조회 결과 인용스냅샷의 지정 문자열 포함 확인
            expect(
                newer.cite("VAR_REVIEW_PROCESS").find((citation) => citation.section === "6")
                    ?.quoteSnapshot
            ).toContain("OFR");
        }
    );

    it("중첩 데이터와 인용을 동결하고 반환 배열 변경은 다음 조회에 영향을 주지 않는다", () => {
        // 규정집 시험용 대회 규정목록 결과 준비
        const book = competitionRules("K리그1", "2026")!;
        // 대회 규정목록 결과의 기대값 규정집 일치 확인
        expect(competitionRules("K리그1", "2026")).toBe(book);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(book)).toBe(true);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(book.source)).toBe(true);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(book.scopeCategories)).toBe(true);
        // 규정집 적용범위 전체충족 결과의 기대값 참 일치 확인
        expect(book.scopeCategories.every(Object.isFrozen)).toBe(true);
        // 인용목록 시험용 규정집 결과 준비
        const citations = book.cite("VAR_REVIEWABLE_CATEGORIES");
        // 인용목록 전체충족 결과의 기대값 참 일치 확인
        expect(citations.every(Object.isFrozen)).toBe(true);
        // 인용목록 구간치환 결과 처리 수행
        citations.splice(0, citations.length);
        // 규정집 결과 길이의 0 초과 확인
        expect(book.cite("VAR_REVIEWABLE_CATEGORIES").length).toBeGreaterThan(0);
    });
});

describe("combineCompetitionRules", () => {
    it.each([
        { competition: "K리그3", season: "2026", ifabVersionId: "ifab-2026-27" },
        { competition: "K리그1", season: "2027", ifabVersionId: "ifab-2026-27" },
        { competition: "K리그1", season: "2026", ifabVersionId: "ifab-1998-99" },
        { competition: "K리그1", season: "2026", ifabVersionId: "" }
    ])("미확인 구성요소를 추정하지 않는다: $competition/$season/$ifabVersionId", (selection) => {
        // 대회 집합 결과의 빈 값 확인
        expect(competitionSet(selection)).toBeNull();
    });

    it.each(BOOKS)(
        "$versionId 조합은 근거 있는 개념에만 대회 인용을 덧붙인다",
        ({ competition, season }) => {
            // 기본자료 시험용 규정집 결과 준비
            const base = ruleSet("ifab-2026-27")!;
            // 규정집 시험용 대회 규정목록 결과 준비
            const book = competitionRules(competition, season)!;
            // 시험자료 시험용 대회 집합 결과 준비
            const combined = competitionSet({
                competition,
                season,
                ifabVersionId: "ifab-2026-27"
            })!;
            // 키목록의 각 사례 순회
            for (const concept of CONCEPT_KEYS) {
                // 시험자료 결과의 2개 항목 목록 기준 구조 일치 확인
                expect(combined.cite(concept)).toEqual([
                    ...base.cite(concept),
                    ...book.cite(concept)
                ]);
            }
            // 시험자료 결과의 기본자료 결과 기준 구조 일치 확인
            expect(combined.layerConflicts()).toEqual(base.layerConflicts());
            // 객체 동결여부 결과의 기대값 참 일치 확인
            expect(Object.isFrozen(combined)).toBe(true);
        }
    );

    it.each(BOOKS)(
        "$versionId 네 범주 외 독립 코너 검토를 제한하고 IFAB 원본은 보존한다",
        ({ competition, season }) => {
            // 기본자료 시험용 규정집 결과 준비
            const base = ruleSet("ifab-2026-27")!;
            // 시험자료 시험용 대회 집합 결과 준비
            const combined = competitionSet({
                competition,
                season,
                ifabVersionId: "ifab-2026-27"
            })!;
            // 시험자료 비디오판독 결과 항목변환 결과의 4개 항목 목록 기준 구조 일치 확인
            expect(combined.varCategories().map((category) => category.id)).toEqual([
                "GOAL_NO_GOAL",
                "PENALTY_NO_PENALTY",
                "RED_CARD",
                "MISTAKEN_IDENTITY"
            ]);
            // 기본자료 비디오판독 결과 항목변환 결과의 코너킥 포함 확인
            expect(base.varCategories().map((category) => category.id)).toContain("CORNER_KICK");
            // 객체 동결여부 결과의 기대값 참 일치 확인
            expect(Object.isFrozen(combined.varCategories())).toBe(true);
            // 시험자료 비디오판독 결과 전체충족 결과의 기대값 참 일치 확인
            expect(combined.varCategories().every(Object.isFrozen)).toBe(true);
        }
    );

    it("시즌으로 IFAB 판본을 추정하지 않고 지정 판본의 두 번째 경고와 시간 창 세부 규칙을 유지한다", () => {
        // 2개 항목 목록의 각 사례 순회
        for (const ifabVersionId of ["ifab-2025-26", "ifab-2026-27"]) {
            // 기본자료 시험용 규정집 결과 준비
            const base = ruleSet(ifabVersionId)!;
            // 시험자료 시험용 대회 집합 결과 준비
            const combined = competitionSet({
                competition: "K리그1",
                season: "2026",
                ifabVersionId
            })!;
            // 시험자료 비디오판독 결과 조회 결과의 기본자료 비디오판독 결과 조회 결과 기준 구조 일치 확인
            expect(combined.varCategories().find((category) => category.id === "RED_CARD")).toEqual(
                base.varCategories().find((category) => category.id === "RED_CARD")
            );
            // 시험자료 시간 결과의 기본자료 시간 결과 기준 구조 일치 확인
            expect(combined.timeWindowExceptions()).toEqual(base.timeWindowExceptions());
        }
    });
});
