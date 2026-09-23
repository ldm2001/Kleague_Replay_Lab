import { describe, expect, it } from "vitest";
import {
    assessment,
    decision,
    type DecisionSaveCommand,
    type EvaluationContext,
    type EvaluationStore
} from "@replay/application";
import { competitionSet, ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { observation, type EvaluationFacts } from "@replay/shared-types";

// 세션 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION = "11111111-1111-4111-8111-111111111111";
// 분석 시험용 22222222 2222 4222 8222 222222222222 준비
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
// 후보 시험용 33333333 3333 4333 8333 333333333333 준비
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
// 사실 시험용 44444444 4444 4444 8444 444444444444 준비
const FACT = "44444444-4444-4444-8444-444444444444";
// 버전 시험용 55555555 5555 4555 8555 555555555555 준비
const VERSION = "55555555-5555-4555-8555-555555555555";
// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-09-03T00:00:00.000Z");
// 사실 시험 입력으로 추가 및 변수 및 관측결과 자료 생성
const facts: EvaluationFacts = {
    push: {
        contactDetected: observation(true, "NORMAL", []),
        severity: observation("RECKLESS", "NORMAL", []),
        opponentDisplacement: observation("clear", "NORMAL", []),
        insidePenaltyArea: observation(true, "NORMAL", []),
        cameraSufficiency: "HIGH",
    },
    variable: {
        reviewScenario: "PENALTY_NOT_GIVEN", restartOccurred: false,
        sendOffCategory: "NONE", mistakenIdentity: false, decisionNature: "SUBJECTIVE",
        errorMagnitude: "CLEAR_AND_OBVIOUS", seriousMissedIncident: false,
    },
    observed: {
        restartType: "PLAY_CONTINUED", restartBeneficiary: "NONE", card: null,
        goalDecision: "NOT_APPLICABLE", source: "USER_INPUT",
    },
};

// 실행 시험용 평가 결과 준비
const run = assessment({
    rule: ruleSet, competitionRule: competitionSet, push: pushResult, variable: varResult,
    hash: async () => new Uint8Array(32),
});

// 검증용 실행 구성
const execute = async (competition?: EvaluationContext["competition"]) => {
    // 저장결과 시험용 0개 항목 목록 준비
    const saved: DecisionSaveCommand[] = [];
    // 맥락 시험 입력으로 분석 식별자 및 분석상태버전 1 및 후보 식별자 및 사실 개정번호 식별자 자료 생성
    const context: EvaluationContext = {
        analysisId: ANALYSIS, analysisStateVersion: 1, candidateId: CANDIDATE, factRevisionId: FACT,
        facts, ruleVersionId: "ifab-2025-26", ruleVersionDbId: VERSION, competitionOptions: {},
        ...(competition ? { competition } : {}),
    };
    // 저장소 시험 입력으로 수정항목 및 맥락 및 저장 자료 생성
    const repository: EvaluationStore = {
        patch: async () => ({ kind: "NOT_FOUND" }),
        context: async () => ({ kind: "READY", value: context }),
        save: async (command) => {
            // 저장결과 추가 결과 처리 수행
            saved.push(command);
            // 종류 생성완료 및 판정 식별자 자료 반환
            return { kind: "CREATED", decisionId: CANDIDATE };
        },
    };
    // 판정 결과를 결과에 저장
    const result = await decision({ clock: { now: () => NOW }, repository, run })({
        anonymousSessionId: SESSION, analysisId: ANALYSIS, candidateId: CANDIDATE,
    });
    // 결과 및 저장결과 자료 반환
    return { result, saved };
};

describe("decision competition context", () => {
    it("uses a new engine version for competition-composed evaluations", async () => {
        // 실행 결과를 저장결과에 저장
        const { saved } = await execute({ competition: "K리그1", season: "2026" });

        // 저장결과 중 선택 항목 규정 버전의 기대값 규정 판정 일치 확인
        expect(saved[0]?.ruleEngineVersion).toBe("rule-engine-v3-judgment-contract");
        // 저장결과 중 선택 항목 스키마 버전의 기대값 2 일치 확인
        expect(saved[0]?.evaluationSchemaVersion).toBe(2);
    });

    it.each([
        ["K리그1", "2025", "kleague1-2025"],
        ["K리그2", "2025", "kleague2-2025"],
        ["K리그1", "2026", "kleague1-2026"],
        ["K리그2", "2026", "kleague2-2026"]
    ])(
        "forwards the bound %s %s rule book to assessment",
        async (competition, season, versionId) => {
            // 실행 결과를 결과 저장결과에 저장
            const { result, saved } = await execute({ competition, season });

            // 결과 종류의 기대값 생성완료 일치 확인
            expect(result.kind).toBe("CREATED");
            // 저장결과의 항목 수 1 확인
            expect(saved).toHaveLength(1);
            // 인용목록 시험용 저장결과 중 선택 항목 인용목록 필터 결과 준비
            const citations = saved[0]!.evaluation.citations.filter(
                (item) => item.authority === "KLEAGUE"
            );
            // 인용목록 길이의 0 초과 확인
            expect(citations.length).toBeGreaterThan(0);
            // 인용목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                citations.every(
                    (item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === season
                )
            ).toBe(true);
        }
    );

    it.each([
        ["unknown", "2026"],
        ["K리그1", "2024"]
    ])(
        "does not save an evaluation without matching %s %s rule data",
        async (competition, season) => {
            // 실행 결과를 결과 저장결과에 저장
            const { result, saved } = await execute({ competition, season });

            // 규정 버전 미확인 조건을 포함한 기대 결과 일치 확인
            expect(result).toEqual({ kind: "RULE_VERSION_UNKNOWN" });
            // 저장결과의 항목 수 0 확인
            expect(saved).toHaveLength(0);
        }
    );

    it("preserves standalone IFAB evaluation without competition context", async () => {
        // 실행 결과를 결과 저장결과에 저장
        const { result, saved } = await execute();

        // 결과 종류의 기대값 생성완료 일치 확인
        expect(result.kind).toBe("CREATED");
        // 저장결과 중 선택 항목 인용목록 전체충족 결과의 기대값 참 일치 확인
        expect(saved[0]!.evaluation.citations.every((item) => item.authority === "IFAB")).toBe(
            true
        );
    });
});
