// 평가 엔진 테스트
import { describe, expect, it } from "vitest";
import type { CompetitionOptions, PushFacts, VarFacts } from "@replay/shared-types";
import { competitionSet, ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { assessment } from "./assessment.js";
import { context } from "../../../../test/fixtures/push-context";

// 추가 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
const push: PushFacts = {
    contactDetected: { value: true, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
    severity: { value: "RECKLESS", observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
    opponentDisplacement: { value: "clear", observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
    insidePenaltyArea: { value: false, observedAtSpeed: "NORMAL", shotIds: ["shot-1"] },
    cameraSufficiency: "HIGH",
    context: context(),
};

// 변수 시험 입력으로 판독시나리오 지정 문자열 및 재개 거짓 및 전송 분류 없음 및 대상착오 거짓 자료 생성
const variable: VarFacts = {
    reviewScenario: "GOAL_DISALLOWED",
    restartOccurred: false,
    sendOffCategory: "NONE",
    mistakenIdentity: false,
    decisionNature: "SUBJECTIVE",
    errorMagnitude: "UNDETERMINED",
    seriousMissedIncident: false,
};

// 관측결과 시험용 재개 유형 지정 문자열 및 재개수혜팀 지정 문자열 및 카드 빈 값 및 판정 지정 문자열 자료 준비
const observed = {
    restartType: "UNKNOWN", restartBeneficiary: "UNKNOWN", card: null,
    goalDecision: "UNKNOWN", source: "USER_INPUT",
} as const;

// 규정 평가 유스케이스 테스트
describe("assessment", () => {
    it("combines pushing rules and VAR gates with citations", async () => {
        // 밀기와 비디오 판독 판정 의존성 구성
        const result = await assessment({
            rule: (id) => ruleSet(id),
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32).fill(1)
        })({
            ruleVersionId: "ifab-2025-26",
            push,
            variable,
            observed,
            options: {} satisfies CompetitionOptions
        });

        // 평가 성공 확인
        expect(result.kind).toBe("EVALUATED");
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "EVALUATED") return;
        // 결과 값 비디오판독평가 분류의 기대값 지정 문자열 일치 확인
        expect(result.value.varAssessment?.category).toBe("GOAL_NO_GOAL");
        // 결과 값 인용목록 길이의 1 초과 확인
        expect(result.value.citations.length).toBeGreaterThan(1);
        // 결과 값 사실 서명의 지정 패턴 일치 확인
        expect(result.value.factSignature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects an unknown rule version", async () => {
        // 규정 버전 미확인 조건을 포함한 기대 결과 일치 확인
        await expect(
            assessment({
                rule: () => null,
                push: pushResult,
                variable: varResult,
                hash: async () => new Uint8Array(32)
            })({ ruleVersionId: "ifab-missing", push, variable, observed, options: {} })
        ).resolves.toEqual({
            kind: "RULE_VERSION_UNKNOWN"
        });
    });

    it.each([
        ["K리그1", "2025", "kleague1-2025"],
        ["K리그2", "2025", "kleague2-2025"],
        ["K리그1", "2026", "kleague1-2026"],
        ["K리그2", "2026", "kleague2-2026"]
    ])("evaluates with the selected %s %s rule book", async (competition, season, versionId) => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: ruleSet,
            competitionRule: competitionSet,
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32)
        })({
            ruleVersionId: "ifab-2025-26",
            competition: { competition, season },
            push,
            variable,
            observed,
            options: {}
        });

        // 결과 종류의 기대값 평가완료 일치 확인
        expect(result.kind).toBe("EVALUATED");
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "EVALUATED") return;
        // 인용목록 시험용 결과 값 인용목록 필터 결과 준비
        const leagueCitations = result.value.citations.filter(
            (item) => item.authority === "KLEAGUE"
        );
        // 인용목록 길이의 0 초과 확인
        expect(leagueCitations.length).toBeGreaterThan(0);
        // 인용목록 전체충족 결과의 기대값 참 일치 확인
        expect(
            leagueCitations.every(
                (item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === season
            )
        ).toBe(true);
        // 결과 값 인용목록 일부충족 결과의 기대값 참 일치 확인
        expect(
            result.value.citations.some(
                (item) => item.authority === "IFAB" && item.edition === "2025-26"
            )
        ).toBe(true);
    });

    it.each([
        ["unknown", "2026"],
        ["K리그1", "2024"],
        ["K리그2", "2027"]
    ])("rejects unavailable competition data for %s %s", async (competition, season) => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: ruleSet,
            competitionRule: competitionSet,
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32)
        })({
            ruleVersionId: "ifab-2025-26",
            competition: { competition, season },
            push,
            variable,
            observed,
            options: {}
        });

        // 규정 버전 미확인 조건을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
    });

    it("does not silently ignore competition when its resolver is unavailable", async () => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: ruleSet,
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32)
        })({
            ruleVersionId: "ifab-2025-26",
            competition: { competition: "K리그1", season: "2026" },
            push,
            variable,
            observed,
            options: {}
        });

        // 규정 버전 미확인 조건을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
    });

    it("applies the K League scope before evaluating the IFAB corner option", async () => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: ruleSet,
            competitionRule: competitionSet,
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32)
        })({
            ruleVersionId: "ifab-2026-27",
            competition: { competition: "K리그2", season: "2026" },
            push,
            variable: { ...variable, reviewScenario: "CORNER_KICK_AWARDED" },
            observed,
            options: {}
        });

        // 개입 없음 조건을 포함한 기대 결과 일치 확인
        expect(result).toMatchObject({
            kind: "EVALUATED",
            value: {
                varAssessment: {
                    reviewable: false,
                    notReviewableReason: "OUTSIDE_REVIEWABLE_CATEGORIES",
                    intervention: "NO_INTERVENTION"
                }
            }
        });
    });

    it.each([
        ["DIRECT_FREE_KICK", "CAUTION", "MATCH"],
        ["DIRECT_FREE_KICK", null, "UNDETERMINED"],
        ["PLAY_CONTINUED", "NONE", "MISMATCH"],
        ["UNKNOWN", null, "UNDETERMINED"]
    ] as const)("관측 판정 %s 비교", async (restartType, card, match) => {
        // 관측 판정과 규정 결과를 별도 비교
        const operation = assessment({
            rule: (id) => ruleSet(id),
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32).fill(1)
        });
        // 입력 시험용 규정 버전 식별자 2025 26 및 추가 및 변수 및 옵션 자료 준비
        const input = {
            ruleVersionId: "ifab-2025-26",
            push,
            variable,
            options: {},
            observed: {
                restartType,
                restartBeneficiary: "DEFENDING_TEAM",
                card,
                goalDecision: "NOT_APPLICABLE",
                source: "USER_INPUT"
            }
        } as Parameters<typeof operation>[0] & {
            observed: import("@replay/shared-types").ObservedDecision;
        };
        // 작업 결과를 결과에 저장
        const result = await operation(input);
        // 결과의 종류 평가완료 및 값 자료의 필드 일치 확인
        expect(result).toMatchObject({ kind: "EVALUATED", value: { decisionMatch: match } });
    });

    it("파울 없음과 카드 없음은 득점·수혜 팀도 확인됐을 때만 일치", async () => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: (id) => ruleSet(id),
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32).fill(1)
        })({
            ruleVersionId: "ifab-2025-26",
            push: { ...push, contactDetected: { ...push.contactDetected, value: false } },
            variable,
            options: {},
            observed: {
                ...observed,
                restartType: "PLAY_CONTINUED",
                restartBeneficiary: "NONE",
                card: "NONE",
                goalDecision: "NOT_APPLICABLE"
            }
        });
        // 결과의 종류 평가완료 및 값 자료의 필드 일치 확인
        expect(result).toMatchObject({ kind: "EVALUATED", value: { decisionMatch: "MATCH" } });
    });

    it.each([
        ["ATTACKING_TEAM", "MISMATCH"],
        ["DEFENDING_TEAM", "MATCH"],
        ["UNKNOWN", "UNDETERMINED"],
        ["NONE", "MISMATCH"]
    ] as const)(
        "수혜 팀 %s를 독립적인 기대 팀과 비교한다",
        async (restartBeneficiary, expected) => {
            // 평가 결과를 결과에 저장
            const result = await assessment({
                rule: ruleSet,
                push: pushResult,
                variable: varResult,
                hash: async () => new Uint8Array(32)
            })({
                ruleVersionId: "ifab-2025-26",
                push,
                variable,
                options: {},
                observed: {
                    ...observed,
                    restartType: "DIRECT_FREE_KICK",
                    restartBeneficiary,
                    card: "CAUTION",
                    goalDecision: "NOT_APPLICABLE"
                }
            });
            // 결과의 종류 평가완료 및 값 자료의 필드 일치 확인
            expect(result).toMatchObject({ kind: "EVALUATED", value: { decisionMatch: expected } });
        }
    );

    it.each(["GOAL", "NO_GOAL", "UNKNOWN"] as const)(
        "밀기 평가만으로 득점 %s의 전체 일치를 주장하지 않는다",
        async (goalDecision) => {
            // 평가 결과를 결과에 저장
            const result = await assessment({
                rule: ruleSet,
                push: pushResult,
                variable: varResult,
                hash: async () => new Uint8Array(32)
            })({
                ruleVersionId: "ifab-2025-26",
                push,
                variable,
                options: {},
                observed: {
                    ...observed,
                    restartType: "DIRECT_FREE_KICK",
                    restartBeneficiary: "DEFENDING_TEAM",
                    card: "CAUTION",
                    goalDecision
                }
            });
            // 미확정 조건을 포함한 기대 결과 일치 확인
            expect(result).toMatchObject({
                kind: "EVALUATED",
                value: { decisionMatch: "UNDETERMINED" }
            });
        }
    );

    it("원심 관측도 재현 서명 입력에 포함한다", async () => {
        // 평가 결과를 결과에 저장
        const result = await assessment({
            rule: ruleSet,
            push: pushResult,
            variable: varResult,
            hash: async () => new Uint8Array(32)
        })({
            ruleVersionId: "ifab-2025-26",
            push,
            variable,
            options: {},
            observed
        });
        // 결과 종류 비교 조건에 따른 처리 경로 분기
        if (result.kind !== "EVALUATED") throw new Error("evaluation failed");
        // 응답본문 해석 결과 관측결과의 관측결과 기준 구조 일치 확인
        expect(JSON.parse(result.value.factSignatureInput).observed).toEqual(observed);
    });
});
