import { describe, expect, it } from "vitest";
import { competitionRules } from "@replay/rule-data";
import { scopeVerdict } from "../../src/rules/engine/var/scope";

// 단서 시험 입력으로 종류 지정 문자열 및 방법 방송 및 시작시각 1000 및 종료시각 1400 자료 생성
const cue = { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000,
    endMs: 1400, evidenceTimestampsMs: [1000, 1200, 1400] };
// 원본 시험 입력으로 원본 해시 및 경기 키 검증완료 경기 및 대회 및 시즌 2026 자료 생성
const source = {
    sourceSha256: "ab".repeat(32),
    matchKey: "verified-test-match",
    competition: "K리그2" as const,
    season: "2026",
    verification: "REGISTERED_SOURCE_HASH" as const,
    sourceUrls: ["https://example.test/match"]
};
// 입력 시험 입력으로 방송 단서 및 시작시각 0 및 종료시각 2000 및 근거 자료 생성
const input = { broadcastCue: cue, startMs: 0, endMs: 2000,
    evidence: [{ evidenceId: "clip", kind: "CLIP" as const, startMs: 0, endMs: 2000 }], source };

describe("competition VAR scope", () => {
    it.each([
        ["K리그1", "2025"],
        ["K리그2", "2025"],
        ["K리그1", "2026"],
        ["K리그2", "2026"]
    ] as const)(
        "answers the category question using exactly %s %s and no fabricated foul decision",
        (competition, season) => {
            // 규정집 시험용 대회 규정목록 결과 준비
            const book = competitionRules(competition, season)!;
            // 결과 시험용 적용범위 판단 결과 준비
            const result = scopeVerdict(
                { ...input, source: { ...source, competition, season } },
                book
            )!;
            // 결과의 종류 대회 비디오판독 적용범위 및 상태 완료 및 주제 득점관련 및 지정 항목 참 자료의 필드 일치 확인
            expect(result).toMatchObject({
                kind: "COMPETITION_VAR_SCOPE",
                status: "COMPLETED",
                topic: "GOAL_RELATED",
                included: true,
                competition,
                season,
                ruleVersionId: book.versionId,
                provenance: {
                    origin: "VIDEO_CUE_AND_COMPETITION_RULES",
                    sourceSha256: source.sourceSha256,
                    ruleDocumentSha256: book.source.documentSha256,
                    cueStartMs: 1000,
                    cueEndMs: 1400
                }
            });
            // 결과 인용목록 길이의 0 초과 확인
            expect(result.citations.length).toBeGreaterThan(0);
            // 결과 인용목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                result.citations.every(
                    (item) =>
                        item.authority === "KLEAGUE" &&
                        item.edition === season &&
                        item.ruleId.startsWith(book.versionId)
                )
            ).toBe(true);
            // 결과 미평가항목의 비디오판독 포함 확인
            expect(result.notAssessed).toContain("VAR_CHECK_PERFORMED");
            // 결과 미평가항목의 판정 포함 확인
            expect(result.notAssessed).toContain("REFEREE_DECISION_CORRECTNESS");
            // 결과 미평가항목의 판본 포함 확인
            expect(result.notAssessed).toContain("IFAB_EDITION_ADOPTION");
            // 결과의 판정 항목 없음 확인
            expect(result).not.toHaveProperty("decision");
            // 결과의 지정 문자열 항목 없음 확인
            expect(result).not.toHaveProperty("intervention");
            // 결과의 제공된 포함 확인
            expect(result.explanation).toContain("제공된");
        }
    );

    it("does not infer a match, invent missing evidence or accept a renamed goal decision", () => {
        // 규정집 시험용 대회 규정목록 결과 준비
        const book = competitionRules("K리그2", "2026");
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict({ ...input, source: null }, book)).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict(input, null)).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict({ ...input, evidence: [] }, book)).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(
            scopeVerdict({ ...input, evidence: [{ ...input.evidence[0]!, kind: "FRAME" }] }, book)
        ).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(
            scopeVerdict({ ...input, evidence: [{ ...input.evidence[0]!, endMs: 1200 }] }, book)
        ).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(
            scopeVerdict({ ...input, broadcastCue: { ...cue, kind: "GOAL_AWARDED" } }, book)
        ).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict({ ...input, broadcastCue: { ...cue, endMs: 3000 } }, book)).toBeNull();
    });

    it("refuses league, season, provenance and source-citation mismatches", () => {
        // 규정집 시험용 대회 규정목록 결과 준비
        const book = competitionRules("K리그2", "2026")!;
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict(input, competitionRules("K리그1", "2026"))).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict(input, competitionRules("K리그2", "2025"))).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(
            scopeVerdict({ ...input, source: { ...source, verification: "USER" } as never }, book)
        ).toBeNull();
        // 적용범위 판단 결과의 빈 값 확인
        expect(scopeVerdict(input, { ...book, cite: () => [] })).toBeNull();
    });
});
