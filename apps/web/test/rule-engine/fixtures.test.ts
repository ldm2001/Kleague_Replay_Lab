import type {
    CompetitionOptions,
    EvaluationResult,
    PushFacts,
    VarAssessment,
    VarFacts
} from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { beforeAll, describe, expect, it } from "vitest";
import pushSuite from "../../src/rules/engine/fixtures/push-decision.fixtures.json" with { type: "json" };
import varSuite from "../../src/rules/engine/fixtures/var-assessment.fixtures.json" with { type: "json" };
import { pushResult, varResult, FORBIDDEN_SIGNATURE_KEY_PATTERN } from "@replay/rule-engine";

type Json = Record<string, unknown>;

// 기준 사실 위에 케이스 값을 병합
const input = (baseline: Json, overrides: Json): Json => ({ ...baseline, ...overrides });

// 관측값에 샷 식별자 기본값 추가
const shape = (facts: Json): Json => {
    // 출력 시험 입력으로 자료 생성
    const output: Json = {};
    // 객체 항목목록 결과의 각 사례 순회
    for (const [key, value] of Object.entries(facts)) {
        // 출력 중 선택 항목을 입력 조건 값으로 설정
        output[key] =
            value !== null && typeof value === "object" && "value" in (value as Json)
                ? { shotIds: [], ...(value as Json) }
                : value;
    }
    // 출력 반환
    return output;
};

// 기대값에 지정된 필드만 비교
const subset = (actual: Json, expected: Json, caseId: string) => {
    // 객체 항목목록 결과의 각 사례 순회
    for (const [key, value] of Object.entries(expected)) {
        // 실제값 중 선택 항목의 값 기준 구조 일치 확인
        expect(actual[key], `${caseId}: ${key}`).toEqual(value);
    }
};

// 추가 시험용 대응표 준비
const pushResults = new Map<string, EvaluationResult>();

describe("push-decision 픽스처", () => {
    beforeAll(() => {
        // 밀기평가묶음의 각 사례 순회
        for (const testCase of pushSuite.cases) {
            // 케이스별 판본 덮어쓰기 지원
            const ruleVersion =
                (testCase.given as { ruleVersion?: string }).ruleVersion ??
                pushSuite.defaults.ruleVersion;
            // 규정목록 시험용 규정집 결과 준비
            const rules = ruleSet(ruleVersion);
            // 규정목록의 값 존재 확인
            expect(rules, `${testCase.id}: 알 수 없는 판본 ${ruleVersion}`).not.toBeNull();
            // 사실 시험용 시험자료 결과 준비
            const facts = shape(
                input(pushSuite.baseline as Json, testCase.given.facts as Json)
            ) as unknown as PushFacts;
            // 추가 묶음 결과 처리 수행
            pushResults.set(testCase.id, pushResult(facts, rules!));
        }
    });

    it.each(pushSuite.cases.map((testCase) => [testCase.id, testCase] as const))(
        "%s",
        (id, testCase) => {
            // 실제 평가에 기대하는 부분 결과 포함 확인
            subset(pushResults.get(id)! as unknown as Json, testCase.expect as Json, id);
        }
    );

    it("push-09 — 모든 결과에 조항 인용이 최소 하나 붙는다", () => {
        // 추가 크기의 기대값 밀기평가묶음 길이 일치 확인
        expect(pushResults.size).toBe(pushSuite.cases.length);
        // 추가의 각 사례 순회
        for (const [id, result] of pushResults) {
            // 결과 인용목록 길이의 1 이상 확인
            expect(result.citations.length, `${id}에 인용이 없다`).toBeGreaterThanOrEqual(1);
        }
    });

    it("push-10 — 사실값이 막혀도 accounts가 비지 않고 막힌 사실이 보고된다", () => {
        // 시험자료 시험용 밀기평가묶음 조회 결과 준비
        const invariant = pushSuite.invariants.find((entry) => entry.id === "push-10")!;
        // 식별자목록 시험용 시험자료 준비
        const ids = invariant.appliesTo as string[];
        // 식별자목록 길이의 기대값 시험자료 기대값 개수 일치 확인
        expect(ids.length).toBe(invariant.expectedAppliesCount);

        // 식별자목록의 각 사례 순회
        for (const id of ids) {
            // 결과 시험용 추가 조회 결과 준비
            const result = pushResults.get(id)!;
            // 결과 보류 변환 길이의 0 초과 확인
            expect(result.blockedFrom.length, `${id}: 막힌 사실이 없다`).toBeGreaterThan(0);
            // 결과 설명목록 길이의 0 초과 확인
            expect(result.accounts.length, `${id}: accounts가 비었다`).toBeGreaterThan(0);

            // 신고 시험용 집합 준비
            const declared = new Set(
                result.accounts.flatMap((account) => account.requires.map((entry) => entry.fact))
            );
            // 결과 보류 변환의 각 사례 순회
            for (const blocked of result.blockedFrom) {
                // 신고의 보류 사실 포함 확인
                expect(declared, `${id}: ${blocked.fact}가 accounts에 없다`).toContain(
                    blocked.fact
                );
            }
        }

        // 차단 목록 외 케이스 확인
        for (const testCase of pushSuite.cases) {
            // 식별자목록 포함여부 결과에 따른 처리 경로 분기
            if (ids.includes(testCase.id)) continue;
            // 추가 조회 결과 보류 변환 길이의 기대값 0 일치 확인
            expect(
                pushResults.get(testCase.id)!.blockedFrom.length,
                `${testCase.id}는 막히지 않아야 하는데 막혔다`
            ).toBe(0);
        }
    });
});

type VarRun =
    | { ok: true; assessment: VarAssessment; signature: string; signatureInput: string }
    | { ok: false; error: string };

// 비디오판독 시험용 대응표 준비
const varResults = new Map<string, VarRun>();

// 검증용 비디오 판독 사례 구성
const varCase = (testCase: (typeof varSuite.cases)[number]): VarRun => {
    // 규정 버전 시험용 시험사례 규정 버전 비교 조건 준비
    const ruleVersion =
        (testCase.given as { ruleVersion?: string }).ruleVersion ?? varSuite.defaults.ruleVersion;
    // 규정목록 시험용 규정집 결과 준비
    const rules = ruleSet(ruleVersion);
    // 규정목록의 값 존재 확인
    expect(rules, `${testCase.id}: 알 수 없는 판본 ${ruleVersion}`).not.toBeNull();
    // 옵션 시험용 시험사례 대회 옵션 비교 조건 준비
    const options = ((testCase.given as { competitionOptions?: unknown }).competitionOptions ??
        varSuite.defaults.competitionOptions) as CompetitionOptions;
    // 사실 시험용 입력 결과 준비
    const facts = input(
        varSuite.baseline as Json,
        testCase.given.facts as Json,
    ) as unknown as VarFacts;

    // 처리결과 시험용 비디오판독 결과 준비
    const outcome = varResult(facts, rules!, options);
    // 입력 조건 반환
    return outcome.ok
        ? {
                ok: true,
                assessment: outcome.assessment,
                signature: outcome.factSignature,
                signatureInput: outcome.factSignatureInput,
            }
        : { ok: false, error: outcome.error };
};

describe("var-assessment 픽스처", () => {
    beforeAll(() => {
        // 비디오판독의 각 사례 순회
        for (const testCase of varSuite.cases) {
            // 비디오판독 묶음 결과 처리 수행
            varResults.set(testCase.id, varCase(testCase));
        }
    });

    it.each(varSuite.cases.map((testCase) => [testCase.id, testCase] as const))(
        "%s",
        (id, testCase) => {
            // 실행 시험용 비디오판독 조회 결과 준비
            const run = varResults.get(id)!;
            // 기대값 시험용 시험사례 준비
            const expected = testCase.expect as Json;

            // 오류 비교 조건에 따른 처리 경로 분기
            if ("error" in expected) {
                // 실행의 기대값 거짓 일치 확인
                expect(run.ok, `${id}: 오류를 기대했는데 결과가 나왔다`).toBe(false);
                // 실행 오류의 기대값 기대값 오류 일치 확인
                expect((run as { error: string }).error).toBe(expected.error);
                // 대상 값 반환
                return;
            }

            // 실행의 기대값 참 일치 확인
            expect(run.ok, `${id}: 결과를 기대했는데 오류가 났다`).toBe(true);
            // 실제 평가에 기대하는 부분 결과 포함 확인
            subset(
                (run as { assessment: VarAssessment }).assessment as unknown as Json,
                expected,
                id
            );
        }
    );

    it("var-19 — 네 게이트가 항상 별도 필드로 나온다", () => {
        // 시험자료 시험용 1개 항목 목록 필터 결과 준비
        const successful = [...varResults.entries()].filter(
            (entry): entry is [string, Extract<VarRun, { ok: true }>] => entry[1].ok
        );
        // 비디오 판독 사례 21은 오류 케이스
        expect(successful.length).toBe(varSuite.cases.length - 1);

        // 비디오판독 항목목록 필터 반환값의 각 사례 순회
        for (const [id, run] of successful) {
            // 전제조건목록 시험용 실행 평가 준비
            const gates = run.assessment as unknown as Json;
            // 4개 항목 목록의 각 사례 순회
            for (const field of [
                "category",
                "withinTimeWindow",
                "thresholdMet",
                "reviewProcedure"
            ]) {
                // 객체 존재여부 결과의 기대값 참 일치 확인
                expect(Object.hasOwn(gates, field), `${id}: ${field} 필드가 없다`).toBe(true);
                // 전제조건목록 중 선택 항목의 정의된 값 확인
                expect(gates[field], `${id}: ${field}가 비었다`).not.toBeUndefined();
            }
        }

        // 게이트 독립성 증거
        const reviewableButNoIntervention = successful.some(
            ([, run]) =>
                run.assessment.reviewable && run.assessment.intervention === "NO_INTERVENTION"
        );
        // 일부충족 반환값의 기대값 참 일치 확인
        expect(
            reviewableButNoIntervention,
            "검토 대상이면서 개입하지 않은 결과가 하나도 없다"
        ).toBe(true);

        // 분류 임계값 시험용 비디오판독 항목목록 필터 반환값 일부충족 결과 준비
        const outsideCategoryButThresholdMet = successful.some(
            ([, run]) => !run.assessment.reviewable && run.assessment.thresholdMet === "MET"
        );
        // 분류 임계값의 기대값 참 일치 확인
        expect(outsideCategoryButThresholdMet, "범주 밖이면서 문턱을 넘은 결과가 하나도 없다").toBe(
            true
        );
    });

    it("var-20 — fact_signature가 결정적이고 경기·심판 식별자를 포함하지 않는다", () => {
        // 서명 시험용 대응표 준비
        const bySignature = new Map<string, string>();

        // 비디오판독의 각 사례 순회
        for (const testCase of varSuite.cases) {
            // 첫결과 시험용 비디오판독 조회 결과 준비
            const first = varResults.get(testCase.id)!;
            // 첫결과 부정 조건에 따른 처리 경로 분기
            if (!first.ok) continue;

            // 첫결과 서명의 지정 패턴 일치 확인
            expect(first.signature, `${testCase.id}: 서명 형식`).toMatch(/^[0-9a-f]{64}$/);

            // 시험자료 시험용 비디오판독 사례 결과 준비
            const rerun = varCase(testCase);
            // 비디오판독 사례 반환값의 기대값 참 일치 확인
            expect(rerun.ok).toBe(true);
            // 비디오판독 사례 반환값 서명의 기대값 첫결과 서명 일치 확인
            expect(
                (rerun as Extract<VarRun, { ok: true }>).signature,
                `${testCase.id}: 서명이 실행마다 다르다`
            ).toBe(first.signature);

            // 객체 키목록 결과의 각 사례 순회
            for (const key of Object.keys(JSON.parse(first.signatureInput) as Json)) {
                // 서명 키 결과의 기대값 거짓 일치 확인
                expect(
                    FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key),
                    `${testCase.id}: 서명에 식별자 키 ${key}가 들어 있다`
                ).toBe(false);
            }

            // 시험자료 시험용 서명 조회 결과 준비
            const seen = bySignature.get(first.signature);
            // 서명 조회 반환값 비교 조건에 따른 처리 경로 분기
            if (seen !== undefined) {
                // 같은 서명은 같은 사실 조합
                expect(seen, `${testCase.id}: 다른 입력이 같은 서명을 냈다`).toBe(
                    first.signatureInput
                );
            }
            // 서명 묶음 결과 처리 수행
            bySignature.set(first.signature, first.signatureInput);
        }

        // 서명 크기의 1 초과 확인
        expect(bySignature.size).toBeGreaterThan(1);
    });
});
