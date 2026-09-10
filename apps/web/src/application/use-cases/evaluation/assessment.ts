import type {
  CompetitionOptions,
  CompetitionRuleSelection,
  EvaluationResult,
  ObservedDecision,
  PushFacts,
  RuleSet,
  VarFacts,
  VarOutcome,
} from "@replay/shared-types";

type Rule = (versionId: string) => RuleSet | null;
type CompetitionRule = (selection: CompetitionRuleSelection) => RuleSet | null;
type Push = (facts: PushFacts, rules: RuleSet) => EvaluationResult;
type Variable = (facts: VarFacts, rules: RuleSet, options: CompetitionOptions) => VarOutcome;
type Hash = (value: string) => Promise<Uint8Array>;

export type AssessmentInput = Readonly<{
  ruleVersionId: string;
  competition?: Readonly<{ competition: string; season: string }>;
  push: PushFacts;
  variable: VarFacts;
  options: CompetitionOptions;
  observed: ObservedDecision;
}>;

export type AssessmentResult =
  | Readonly<{ kind: "EVALUATED"; value: EvaluationResult }>
  | Readonly<{ kind: "RULE_VERSION_UNKNOWN" }>
  | Readonly<{ kind: "VAR_EVALUATION_FAILED"; error: string; message: string }>;

export type AssessmentDependencies = Readonly<{
  rule: Rule;
  competitionRule?: CompetitionRule;
  push: Push;
  variable: Variable;
  hash: Hash;
}>;

// 인용 중복 제거
const citations = (value: EvaluationResult, variable: Extract<VarOutcome, { ok: true }>): EvaluationResult["citations"] => {
  // 밀기와 VAR 인용 결합
  const values = [...value.citations, ...variable.citations];
  // 중복 조항 추적
  const seen = new Set<string>();
  // 조항 식별자 기준 중복 제거
  return values.filter((item) => {
    if (seen.has(item.ruleId)) return false;
    seen.add(item.ruleId);
    return true;
  });
};

// 바이트 해시 변환
const hex = (value: Uint8Array): string => Array.from(value, (item) => item.toString(16).padStart(2, "0")).join("");

// 규정 재개와 관측 원심 비교
const comparison = (value: EvaluationResult, observed: ObservedDecision): EvaluationResult["decisionMatch"] => {
  // 관측되지 않은 재개 방식은 비교 보류
  if (observed.restartType === "UNKNOWN" || value.restart === null) return "UNDETERMINED";
  // 재개 방식이 다르면 불일치
  if (observed.restartType !== value.restart) return "MISMATCH";
  // 카드 관측이 없으면 전체 비교 보류
  if (observed.card === null) return "UNDETERMINED";
  // 징계 null은 명시적인 카드 없음과 같은 의미
  const disciplinary = value.disciplinary ?? "NONE";
  // 확인된 카드가 다르면 불일치
  if (observed.card !== disciplinary) return "MISMATCH";
  // 비교 가능한 항목이 모두 같으면 일치
  return "MATCH";
};

// 밀기와 VAR 평가
export const assessment =
  ({ rule, competitionRule, push, variable, hash }: AssessmentDependencies) =>
  async (input: AssessmentInput): Promise<AssessmentResult> => {
    // 분석 대상 규정 판본 조회
    const rules = input.competition
      ? competitionRule?.({ ...input.competition, ifabVersionId: input.ruleVersionId })
      : rule(input.ruleVersionId);
    if (!rules) return { kind: "RULE_VERSION_UNKNOWN" };

    // 밀기 판정 계산
    const pushing = push(input.push, rules);
    // VAR 판정 계산
    const varValue = variable(input.variable, rules, input.options);
    if (!varValue.ok) {
      return { kind: "VAR_EVALUATION_FAILED", error: varValue.error, message: varValue.message };
    }

    // 사실 입력 직렬화
    const factSignatureInput = JSON.stringify({ push: input.push, variable: input.variable });
    // 사실 입력 해시 생성
    const factSignature = hex(await hash(factSignatureInput));
    // 통합 판정 결과 반환
    return {
      kind: "EVALUATED",
      value: {
        ...pushing,
        decisionMatch: comparison(pushing, input.observed),
        varAssessment: varValue.assessment,
        factSignature,
        factSignatureInput,
        citations: citations(pushing, varValue),
      },
    };
  };
