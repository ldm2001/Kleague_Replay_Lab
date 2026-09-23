import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INCONCLUSIVE_REASONS, VAR_INTERVENTIONS } from "@replay/shared-types";
import { inconclusiveReason, varIntervention } from "../../src/database/schema/enums";

describe("judgment contract additive migration", () => {
    it("preserves legacy VAR outcomes alongside computed states", () => {
        // 개입 없음 및 미확정 조건을 포함한 기대 결과 일치 확인
        expect(VAR_INTERVENTIONS).toEqual(
            expect.arrayContaining([
                "OVERTURNED",
                "CONFIRMED",
                "NO_INTERVENTION",
                "INTERVENTION_RECOMMENDED",
                "UNDETERMINED"
            ])
        );
        // 비디오판독 값목록의 비디오판독 기준 구조 일치 확인
        expect(varIntervention.enumValues).toEqual(VAR_INTERVENTIONS);
    });

    it("records missing facts and unsupported context without a false negative", () => {
        // 지원하지 않는 맥락 내용을 포함한 기대 결과 일치 확인
        expect(INCONCLUSIVE_REASONS).toEqual(
            expect.arrayContaining(["FACTS_UNDETERMINED", "CONTEXT_UNSUPPORTED"])
        );
        // 사유 값목록의 사유목록 기준 구조 일치 확인
        expect(inconclusiveReason.enumValues).toEqual(INCONCLUSIVE_REASONS);
    });

    it("adds enum values and allows unknown replay without rewriting history", () => {
        // 질의 시험용 파일읽기 결과 준비
        const sql = readFileSync(
            new URL("../../src/database/migrations/0019_judgment_contract.sql", import.meta.url),
            "utf8"
        );
        // 2개 항목 목록의 각 사례 순회
        for (const [type, values] of [
            ["var_intervention", ["INTERVENTION_RECOMMENDED", "UNDETERMINED"]],
            ["inconclusive_reason", ["FACTS_UNDETERMINED", "CONTEXT_UNSUPPORTED"]]
        ] as const) {
            // 값목록의 각 사례 순회
            for (const value of values)
                // 질의의 지정 형식 문자열 포함 확인
                expect(sql).toContain(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS '${value}'`);
        }
        // 질의의 지정 패턴 일치 확인
        expect(sql).toMatch(/ALTER TABLE shots ALTER COLUMN is_replay DROP NOT NULL/i);
        // 기존 자료 변경과 삭제 및 자료형 삭제 질의가 없음 확인
        expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP TYPE)\b/i);
    });
});
