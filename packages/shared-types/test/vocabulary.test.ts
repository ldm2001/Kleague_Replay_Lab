import { describe, expect, it } from "vitest";
import * as vocabulary from "../src/vocabulary.js";

// `vocabulary()`가 리터럴 튜플 타입을 돌려주므로 `Object.entries`의 값 자리는
// 어휘별 튜플의 합집합이 된다. `unknown`으로 한 번 넓혀야 서술어가 성립한다.
const vocabularyArrays = (): [string, readonly string[]][] =>
  (Object.entries(vocabulary) as [string, unknown][]).filter(
    (entry): entry is [string, readonly string[]] => Array.isArray(entry[1]),
  );

describe("vocabulary", () => {
  it("VAR 범주는 README 8절의 여섯 값을 그 순서로 갖는다", () => {
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
    expect(vocabulary.VAR_NOT_REVIEWABLE_REASONS).toEqual([
      "OUTSIDE_REVIEWABLE_CATEGORIES",
      "COMPETITION_OPTION_NOT_ADOPTED",
    ]);
    expect(vocabulary.VAR_WINDOW_CLOSED_REASONS).toEqual(["PLAY_RESTARTED"]);
    for (const reason of vocabulary.VAR_NOT_REVIEWABLE_REASONS) {
      expect(vocabulary.VAR_WINDOW_CLOSED_REASONS).not.toContain(reason);
    }
  });

  it("모든 어휘 배열은 중복이 없고 동결되어 있다", () => {
    const arrays = vocabularyArrays();
    expect(arrays.length).toBeGreaterThan(20);
    for (const [name, values] of arrays) {
      expect(new Set(values).size, `${name}에 중복 값이 있다`).toBe(values.length);
      expect(Object.isFrozen(values), `${name}이 동결되지 않았다`).toBe(true);
    }
  });

  it("판본 문자열은 어휘에 들어가지 않는다", () => {
    const flat = vocabularyArrays().flatMap(([, values]) => values);
    expect(flat.some((value) => /\d{4}[-/]\d{2}/.test(value))).toBe(false);
  });
});
