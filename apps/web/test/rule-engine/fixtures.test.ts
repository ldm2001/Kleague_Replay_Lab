import type {
  CompetitionOptions,
  EvaluationResult,
  PushFacts,
  VarAssessment,
  VarFacts,
} from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { beforeAll, describe, expect, it } from "vitest";
import pushSuite from "../../src/rules/engine/fixtures/push-decision.fixtures.json" with { type: "json" };
import varSuite from "../../src/rules/engine/fixtures/var-assessment.fixtures.json" with { type: "json" };
import { pushResult, varResult, FORBIDDEN_SIGNATURE_KEY_PATTERN } from "@replay/rule-engine";

type Json = Record<string, unknown>;

// 기준 사실 위에 케이스 값을 병합
const input = (baseline: Json, overrides: Json): Json => ({ ...baseline, ...overrides });

// 관측값에 shotIds 기본값 추가
const shape = (facts: Json): Json => {
  const output: Json = {};
  for (const [key, value] of Object.entries(facts)) {
    output[key] =
      value !== null && typeof value === "object" && "value" in (value as Json)
        ? { shotIds: [], ...(value as Json) }
        : value;
  }
  return output;
};

// 기대값에 지정된 필드만 비교
const subset = (actual: Json, expected: Json, caseId: string) => {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key], `${caseId}: ${key}`).toEqual(value);
  }
};

const pushResults = new Map<string, EvaluationResult>();

describe("push-decision 픽스처", () => {
  beforeAll(() => {
    for (const testCase of pushSuite.cases) {
      // 케이스별 판본 덮어쓰기 지원
      const ruleVersion =
        (testCase.given as { ruleVersion?: string }).ruleVersion ?? pushSuite.defaults.ruleVersion;
      const rules = ruleSet(ruleVersion);
      expect(rules, `${testCase.id}: 알 수 없는 판본 ${ruleVersion}`).not.toBeNull();
      const facts = shape(
        input(pushSuite.baseline as Json, testCase.given.facts as Json),
      ) as unknown as PushFacts;
      pushResults.set(testCase.id, pushResult(facts, rules!));
    }
  });

  it.each(pushSuite.cases.map((testCase) => [testCase.id, testCase] as const))(
    "%s",
    (id, testCase) => {
      subset(pushResults.get(id)! as unknown as Json, testCase.expect as Json, id);
    },
  );

  it("push-09 — 모든 결과에 조항 인용이 최소 하나 붙는다", () => {
    expect(pushResults.size).toBe(pushSuite.cases.length);
    for (const [id, result] of pushResults) {
      expect(result.citations.length, `${id}에 인용이 없다`).toBeGreaterThanOrEqual(1);
    }
  });

  it("push-10 — 사실값이 막혀도 accounts가 비지 않고 막힌 사실이 보고된다", () => {
    const invariant = pushSuite.invariants.find((entry) => entry.id === "push-10")!;
    const ids = invariant.appliesTo as string[];
    expect(ids.length).toBe(invariant.expectedAppliesCount);

    for (const id of ids) {
      const result = pushResults.get(id)!;
      expect(result.blockedFrom.length, `${id}: 막힌 사실이 없다`).toBeGreaterThan(0);
      expect(result.accounts.length, `${id}: accounts가 비었다`).toBeGreaterThan(0);

      const declared = new Set(
        result.accounts.flatMap((account) => account.requires.map((entry) => entry.fact)),
      );
      for (const blocked of result.blockedFrom) {
        expect(declared, `${id}: ${blocked.fact}가 accounts에 없다`).toContain(blocked.fact);
      }
    }

    // 차단 목록 외 케이스 확인
    for (const testCase of pushSuite.cases) {
      if (ids.includes(testCase.id)) continue;
      expect(
        pushResults.get(testCase.id)!.blockedFrom.length,
        `${testCase.id}는 막히지 않아야 하는데 막혔다`,
      ).toBe(0);
    }
  });
});

type VarRun =
  | { ok: true; assessment: VarAssessment; signature: string; signatureInput: string }
  | { ok: false; error: string };

const varResults = new Map<string, VarRun>();

const varCase = (testCase: (typeof varSuite.cases)[number]): VarRun => {
  const ruleVersion =
    (testCase.given as { ruleVersion?: string }).ruleVersion ?? varSuite.defaults.ruleVersion;
  const rules = ruleSet(ruleVersion);
  expect(rules, `${testCase.id}: 알 수 없는 판본 ${ruleVersion}`).not.toBeNull();
  const options = ((testCase.given as { competitionOptions?: unknown }).competitionOptions ??
    varSuite.defaults.competitionOptions) as CompetitionOptions;
  const facts = input(
    varSuite.baseline as Json,
    testCase.given.facts as Json,
  ) as unknown as VarFacts;

  const outcome = varResult(facts, rules!, options);
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
    for (const testCase of varSuite.cases) {
      varResults.set(testCase.id, varCase(testCase));
    }
  });

  it.each(varSuite.cases.map((testCase) => [testCase.id, testCase] as const))(
    "%s",
    (id, testCase) => {
      const run = varResults.get(id)!;
      const expected = testCase.expect as Json;

      if ("error" in expected) {
        expect(run.ok, `${id}: 오류를 기대했는데 결과가 나왔다`).toBe(false);
        expect((run as { error: string }).error).toBe(expected.error);
        return;
      }

      expect(run.ok, `${id}: 결과를 기대했는데 오류가 났다`).toBe(true);
      subset((run as { assessment: VarAssessment }).assessment as unknown as Json, expected, id);
    },
  );

  it("var-19 — 네 게이트가 항상 별도 필드로 나온다", () => {
    const successful = [...varResults.entries()].filter(
      (entry): entry is [string, Extract<VarRun, { ok: true }>] => entry[1].ok,
    );
    // var-21은 오류 케이스
    expect(successful.length).toBe(varSuite.cases.length - 1);

    for (const [id, run] of successful) {
      const gates = run.assessment as unknown as Json;
      for (const field of ["category", "withinTimeWindow", "thresholdMet", "reviewProcedure"]) {
        expect(Object.hasOwn(gates, field), `${id}: ${field} 필드가 없다`).toBe(true);
        expect(gates[field], `${id}: ${field}가 비었다`).not.toBeUndefined();
      }
    }

    // 게이트 독립성 증거
    const reviewableButNoIntervention = successful.some(
      ([, run]) => run.assessment.reviewable && run.assessment.intervention === "NO_INTERVENTION",
    );
    expect(reviewableButNoIntervention, "검토 대상이면서 개입하지 않은 결과가 하나도 없다").toBe(
      true,
    );

    const outsideCategoryButThresholdMet = successful.some(
      ([, run]) => !run.assessment.reviewable && run.assessment.thresholdMet === "MET",
    );
    expect(outsideCategoryButThresholdMet, "범주 밖이면서 문턱을 넘은 결과가 하나도 없다").toBe(
      true,
    );
  });

  it("var-20 — fact_signature가 결정적이고 경기·심판 식별자를 포함하지 않는다", () => {
    const bySignature = new Map<string, string>();

    for (const testCase of varSuite.cases) {
      const first = varResults.get(testCase.id)!;
      if (!first.ok) continue;

      expect(first.signature, `${testCase.id}: 서명 형식`).toMatch(/^[0-9a-f]{64}$/);

      const rerun = varCase(testCase);
      expect(rerun.ok).toBe(true);
      expect(
        (rerun as Extract<VarRun, { ok: true }>).signature,
        `${testCase.id}: 서명이 실행마다 다르다`,
      ).toBe(first.signature);

      for (const key of Object.keys(JSON.parse(first.signatureInput) as Json)) {
        expect(
          FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key),
          `${testCase.id}: 서명에 식별자 키 ${key}가 들어 있다`,
        ).toBe(false);
      }

      const seen = bySignature.get(first.signature);
      if (seen !== undefined) {
        // 같은 서명은 같은 사실 조합
        expect(seen, `${testCase.id}: 다른 입력이 같은 서명을 냈다`).toBe(first.signatureInput);
      }
      bySignature.set(first.signature, first.signatureInput);
    }

    expect(bySignature.size).toBeGreaterThan(1);
  });
});
