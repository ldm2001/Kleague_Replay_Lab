import { createHash as digest } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KNOWN_RULE_VERSION_IDS, ruleSet } from "@replay/rule-data";

// 규정 시험용 규정집 결과 준비
const ruleSet2025 = ruleSet("ifab-2025-26");

// 기본 판본 조회 검증
describe("ruleSet", () => {
    it("알 수 없는 판본에는 null을 반환하고 던지지 않는다", () => {
        // 규정집 결과의 빈 값 확인
        expect(ruleSet("ifab-1998-99")).toBeNull();
        // 규정 버전 식별자목록의 2025 26 포함 확인
        expect(KNOWN_RULE_VERSION_IDS).toContain("ifab-2025-26");
    });

    it("모든 인용이 자기 출처를 전부 갖는다", () => {
        // 규정의 값 존재 확인
        expect(ruleSet2025).not.toBeNull();
        // 인용목록 시험용 8개 항목 목록 준비
        const citations = [
            ...ruleSet2025!.cite("LAW_17_CORNER_PROCEDURE"),
            ...ruleSet2025!.cite("LAW_11_DIRECT_RESTART_OFFSIDE"),
            ...ruleSet2025!.cite("LAW_12_DIRECT_FREE_KICK"),
            ...ruleSet2025!.cite("LAW_12_DISCIPLINE"),
            ...ruleSet2025!.cite("VAR_REVIEWABLE_CATEGORIES"),
            ...ruleSet2025!.cite("VAR_TIME_WINDOW"),
            ...ruleSet2025!.cite("VAR_THRESHOLD"),
            ...ruleSet2025!.cite("VAR_REVIEW_PROCESS")
        ];
        // 인용목록 길이의 0 초과 확인
        expect(citations.length).toBeGreaterThan(0);
        // 인용목록의 각 사례 순회
        for (const citation of citations) {
            // 인용 권한의 기대값 지정 문자열 일치 확인
            expect(citation.authority).toBe("IFAB");
            // 인용 판본의 기대값 2025 26 일치 확인
            expect(citation.edition).toBe("2025-26");
            // 인용 규정 식별자의 지정 패턴 일치 확인
            expect(citation.ruleId).toMatch(/^ifab-2025-26-/);
            // 인용 인용스냅샷 길이의 0 초과 확인
            expect(citation.quoteSnapshot.length).toBeGreaterThan(0);
            // 인용 규정 내용 해시의 기대값 해시 결과 갱신 결과 해시 결과 일치 확인
            expect(citation.ruleContentSha256).toBe(
                digest("sha256").update(citation.quoteSnapshot, "utf8").digest("hex")
            );
        }
    });

    it("2025/26의 검토 가능 범주는 네 개이고 2차 경고는 빠져 있다", () => {
        // 시험자료 시험용 규정 비디오판독 결과 준비
        const categories = ruleSet2025!.varCategories();
        // 규정 비디오판독 반환값 항목변환 결과의 4개 항목 목록 기준 구조 일치 확인
        expect(categories.map((category) => category.id)).toEqual([
            "GOAL_NO_GOAL",
            "PENALTY_NO_PENALTY",
            "RED_CARD",
            "MISTAKEN_IDENTITY"
        ]);
        // 카드 시험용 규정 비디오판독 반환값 조회 결과 준비
        const redCard = categories.find((category) => category.id === "RED_CARD");
        // 퇴장 미선언 조건을 포함한 기대 결과 일치 확인
        expect(redCard?.appliesTo).toEqual(["CARD_SHOWN", "SENDING_OFF_NOT_GIVEN"]);
        // 카드의 두번째결과 미포함 확인
        expect(redCard?.appliesTo).not.toContain("SECOND_CAUTION");
        // 규정 비디오판독 반환값 전체충족 결과의 기대값 참 일치 확인
        expect(categories.every((category) => category.requiresCompetitionOption === null)).toBe(
            true
        );
    });

    it("재개 예외 목록은 데이터가 소유한다", () => {
        // 규정 시간 결과의 대상착오 참 및 전송 자료 기준 구조 일치 확인
        expect(ruleSet2025!.timeWindowExceptions()).toEqual({
            mistakenIdentity: true,
            sendOffCategories: [
                "VIOLENT_CONDUCT",
                "BITING_OR_SPITTING",
                "OFFENSIVE_LANGUAGE_OR_ACTION"
            ]
        });
    });

    it("확인되지 않은 계층 충돌을 지어내지 않는다", () => {
        // 규정 결과의 0개 항목 목록 기준 구조 일치 확인
        expect(ruleSet2025!.layerConflicts()).toEqual([]);
    });

    it("반환된 RuleSet은 동결되어 있고 호출마다 같은 값을 준다", () => {
        // 시험자료 시험용 규정집 결과 준비
        const again = ruleSet("ifab-2025-26");
        // 규정집 반환값의 기대값 규정 일치 확인
        expect(again).toBe(ruleSet2025);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(ruleSet2025)).toBe(true);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(ruleSet2025!.varCategories())).toBe(true);
    });
});

// 판본 차이 검증
describe("판본 차이", () => {
    // 규정 시험용 규정집 결과 준비
    const ruleSet2026 = ruleSet("ifab-2026-27");

    it("2026/27은 다섯 범주이고 코너킥에 대회 채택 옵션이 붙어 있다", () => {
        // 시험자료 시험용 규정 비디오판독 결과 준비
        const categories = ruleSet2026!.varCategories();
        // 규정 비디오판독 반환값 항목변환 결과의 5개 항목 목록 기준 구조 일치 확인
        expect(categories.map((category) => category.id)).toEqual([
            "GOAL_NO_GOAL",
            "PENALTY_NO_PENALTY",
            "RED_CARD",
            "MISTAKEN_IDENTITY",
            "CORNER_KICK"
        ]);
        // 코너킥 시험용 규정 비디오판독 반환값 조회 결과 준비
        const corner = categories.find((category) => category.id === "CORNER_KICK");
        // 코너킥 대회의 기대값 코너킥 일치 확인
        expect(corner?.requiresCompetitionOption).toBe("corner_kick_review");
        // 코너킥의 1개 항목 목록 기준 구조 일치 확인
        expect(corner?.appliesTo).toEqual(["CORNER_KICK_AWARDED"]);
    });

    it("2차 경고는 새 범주가 아니라 퇴장 범주의 적용 대상 확장이다", () => {
        // 시험자료 시험용 규정 비디오판독 결과 조회 결과 준비
        const redCard2026 = ruleSet2026!
            .varCategories()
            .find((category) => category.id === "RED_CARD");
        // 퇴장 미선언 조건을 포함한 기대 결과 일치 확인
        expect(redCard2026?.appliesTo).toEqual([
            "CARD_SHOWN",
            "SENDING_OFF_NOT_GIVEN",
            "SECOND_CAUTION"
        ]);
        // 규정 비디오판독 조회 반환값 대회의 빈 값 확인
        expect(redCard2026?.requiresCompetitionOption).toBeNull();
    });

    it("두 판본의 인용은 판본 문자열까지 서로 다르다", () => {
        // 이전자료 시험용 규정 결과 중 선택 항목 준비
        const older = ruleSet2025!.cite("LAW_12_DIRECT_FREE_KICK")[0]!;
        // 새자료 시험용 규정 결과 중 선택 항목 준비
        const newer = ruleSet2026!.cite("LAW_12_DIRECT_FREE_KICK")[0]!;
        // 이전자료 판본의 기대값 2025 26 일치 확인
        expect(older.edition).toBe("2025-26");
        // 새자료 판본의 기대값 2026 27 일치 확인
        expect(newer.edition).toBe("2026-27");
        // 이전자료 규정 식별자의 기대값 새자료 규정 식별자 불일치 확인
        expect(older.ruleId).not.toBe(newer.ruleId);
        // 이전자료 원본 페이지의 기대값 109 일치 확인
        expect(older.sourcePage).toBe("109");
        // 새자료 원본 페이지의 기대값 115 일치 확인
        expect(newer.sourcePage).toBe("115");
        // 이전자료 출처주소의 기대값 2025 26 일치 확인
        expect(older.sourceUrl).toBe(
            "https://downloads.theifab.com/downloads/laws-of-the-game-2025-26-single-pages?l=en"
        );
        // 새자료 출처주소의 기대값 202627 일치 확인
        expect(newer.sourceUrl).toBe(
            "https://downloads.theifab.com/downloads/laws-of-the-game-202627-single-pages?l=en"
        );
        // 규정 결과 중 선택 항목 출처주소의 기대값 이전자료 출처주소 일치 확인
        expect(ruleSet2025!.cite("VAR_THRESHOLD")[0]!.sourceUrl).toBe(older.sourceUrl);
        // 규정 결과 중 선택 항목 출처주소의 기대값 새자료 출처주소 일치 확인
        expect(ruleSet2026!.cite("VAR_THRESHOLD")[0]!.sourceUrl).toBe(newer.sourceUrl);
    });

    it("재개 예외는 두 판본에서 같다", () => {
        // 규정 시간 결과의 규정 시간 결과 기준 구조 일치 확인
        expect(ruleSet2026!.timeWindowExceptions()).toEqual(ruleSet2025!.timeWindowExceptions());
    });

    it("코너킥 절차와 직접 수신 예외는 확인된 판본별 원문 페이지를 가리킨다", () => {
        // 시험자료 시험용 규정 결과 중 선택 항목 준비
        const corner2025 = ruleSet2025!.cite("LAW_17_CORNER_PROCEDURE")[0]!;
        // 시험자료 시험용 규정 결과 중 선택 항목 준비
        const corner2026 = ruleSet2026!.cite("LAW_17_CORNER_PROCEDURE")[0]!;
        // 시험자료 시험용 규정 결과 중 선택 항목 준비
        const offside2025 = ruleSet2025!.cite("LAW_11_DIRECT_RESTART_OFFSIDE")[0]!;
        // 시험자료 시험용 규정 결과 중 선택 항목 준비
        const offside2026 = ruleSet2026!.cite("LAW_11_DIRECT_RESTART_OFFSIDE")[0]!;
        // 시험자료 원본 페이지의 기대값 143 일치 확인
        expect(corner2025.sourcePage).toBe("143");
        // 시험자료 원본 페이지의 기대값 149 일치 확인
        expect(corner2026.sourcePage).toBe("149");
        // 시험자료 원본 페이지의 기대값 105 일치 확인
        expect(offside2025.sourcePage).toBe("105");
        // 시험자료 원본 페이지의 기대값 111 일치 확인
        expect(offside2026.sourcePage).toBe("111");
        // 시험자료 인용스냅샷의 기대값 시험자료 인용스냅샷 일치 확인
        expect(corner2025.quoteSnapshot).toBe(corner2026.quoteSnapshot);
        // 시험자료 인용스냅샷의 기대값 시험자료 인용스냅샷 일치 확인
        expect(offside2025.quoteSnapshot).toBe(offside2026.quoteSnapshot);
        // 시험자료 인용스냅샷의 지정 패턴 일치 확인
        expect(corner2025.quoteSnapshot).toMatch(/^규정 요약:/);
        // 시험자료 인용스냅샷의 직접 포함 확인
        expect(offside2025.quoteSnapshot).toContain("직접");
    });
});
