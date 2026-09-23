import { describe, expect, it } from "vitest";
import * as vocabulary from "@replay/shared-types";

// 어휘 배열 확인을 위한 공통 목록
const vocabularyArrays = (): [string, readonly string[]][] =>
    (Object.entries(vocabulary) as [string, unknown][]).filter(
        (entry): entry is [string, readonly string[]] => Array.isArray(entry[1]),
    );

describe("vocabulary", () => {
    it("VAR 범주는 README 8절의 여섯 값을 그 순서로 갖는다", () => {
        // 시험자료 비디오판독의 6개 항목 목록 기준 구조 일치 확인
        expect(vocabulary.VAR_CATEGORIES).toEqual([
            "GOAL_NO_GOAL",
            "PENALTY_NO_PENALTY",
            "RED_CARD",
            "MISTAKEN_IDENTITY",
            "CORNER_KICK",
            "NONE",
        ]);
    });

    it("검토 불가 사유와 창 종료 사유를 하나의 열거로 합치지 않는다", () => {
        // 대회 선택 규정 미채택 조건을 포함한 기대 결과 일치 확인
        expect(vocabulary.VAR_NOT_REVIEWABLE_REASONS).toEqual([
            "OUTSIDE_REVIEWABLE_CATEGORIES",
            "COMPETITION_OPTION_NOT_ADOPTED",
        ]);
        // 시험자료 비디오판독 종료여부 사유목록의 1개 항목 목록 기준 구조 일치 확인
        expect(vocabulary.VAR_WINDOW_CLOSED_REASONS).toEqual(["PLAY_RESTARTED"]);
        // 시험자료 비디오판독 사유목록의 각 사례 순회
        for (const reason of vocabulary.VAR_NOT_REVIEWABLE_REASONS) {
            // 시험자료 비디오판독 종료여부 사유목록의 사유 미포함 확인
            expect(vocabulary.VAR_WINDOW_CLOSED_REASONS).not.toContain(reason);
        }
    });

    it("모든 어휘 배열은 중복이 없고 동결되어 있다", () => {
        // 시험자료 시험용 시험자료 결과 준비
        const arrays = vocabularyArrays();
        // 시험자료 길이의 20 초과 확인
        expect(arrays.length).toBeGreaterThan(20);
        // 시험자료의 각 사례 순회
        for (const [name, values] of arrays) {
            // 집합 크기의 기대값 값목록 길이 일치 확인
            expect(new Set(values).size, `${name}에 중복 값이 있다`).toBe(values.length);
            // 객체 동결여부 결과의 기대값 참 일치 확인
            expect(Object.isFrozen(values), `${name}이 동결되지 않았다`).toBe(true);
        }
    });

    it("판본 문자열은 어휘에 들어가지 않는다", () => {
        // 시험자료 시험용 시험자료 결과 대응표 결과 준비
        const flat = vocabularyArrays().flatMap(([, values]) => values);
        // 대응표 반환값 일부충족 결과의 기대값 거짓 일치 확인
        expect(flat.some((value) => /\d{4}[-/]\d{2}/.test(value))).toBe(false);
    });
});
