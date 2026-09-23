import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";

describe("holding rule sources", () => {
    it.each([
        ["ifab-2025-26", "178", "110", "70", "125", "129", "115"],
        ["ifab-2026-27", "200", "116", "74", "131", "135", "121"]
    ])(
        "pins holding and restart references to the %s edition",
        (id, definition, offence, advantage, beneficiary, penalty, continued) => {
            // 규정목록 시험용 규정집 결과 준비
            const rules = ruleSet(id)!;
            // 6개 항목 목록의 각 사례 순회
            for (const [concept, page] of [
                ["LAW_12_HOLDING_DEFINITION", definition],
                ["LAW_12_HOLDING_OFFENCE", offence],
                ["LAW_5_ADVANTAGE", advantage],
                ["LAW_13_BENEFICIARY", beneficiary],
                ["LAW_14_PENALTY", penalty],
                ["LAW_12_CONTINUING_HOLDING", continued]
            ] as const) {
                // 인용목록 시험용 규정목록 결과 준비
                const citations = rules.cite(concept);
                // 인용목록 길이의 0 초과 확인
                expect(citations.length).toBeGreaterThan(0);
                // 인용목록 중 선택 항목의 원본 페이지 및 판본 자료의 필드 일치 확인
                expect(citations[0]).toMatchObject({ sourcePage: page, edition: id.slice(5) });
                // 인용목록 중 선택 항목 규정 내용 해시의 지정 패턴 일치 확인
                expect(citations[0]?.ruleContentSha256).toMatch(/^[a-f0-9]{64}$/);
            }
        }
    );
});
