import { describe, expect, it } from "vitest";
import { automaticContext } from "../../src/adapters/automatic-context";

// 원본 시험용 지정 문자열 준비
const source = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";
describe("automatic context selection", () => {
    it("does not query unknown sources", async () => {
        // 호출기록 시험용 0 준비
        let calls = 0;
        // 자동평가 맥락 결과의 빈 값 확인
        expect(
            await automaticContext("a".repeat(64), async () => {
                // 입력 조건 처리 수행
                calls++;
                // 0개 항목 목록 반환
                return [];
            })
        ).toBeNull();
        // 호출기록의 기대값 0 일치 확인
        expect(calls).toBe(0);
    });
    it("rejects ambiguous matches and leaves ambiguous rules unlinked", async () => {
        // 자동평가 맥락 결과의 빈 값 확인
        expect(await automaticContext(source, async () => [{ id: "a" }, { id: "b" }])).toBeNull();
        // 대기열 시험용 2개 항목 목록 준비
        const queue = [[{ id: "match" }], [{ id: "a" }, { id: "b" }]];
        // 자동평가 맥락 결과의 경기 식별자 경기 및 규정 식별자 빈 값 자료 기준 구조 일치 확인
        expect(await automaticContext(source, async () => queue.shift() ?? [])).toEqual({
            matchId: "match",
            ruleId: null
        });
    });
    it("links only the unique returned match and independently verified rule", async () => {
        // 대기열 시험용 2개 항목 목록 준비
        const queue = [[{ id: "match" }], [{ id: "rule" }]];
        // 자동평가 맥락 결과의 경기 식별자 경기 및 규정 식별자 규정 자료 기준 구조 일치 확인
        expect(await automaticContext(source, async () => queue.shift() ?? [])).toEqual({
            matchId: "match",
            ruleId: "rule"
        });
    });
});
