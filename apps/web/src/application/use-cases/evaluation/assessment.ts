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
const comparison = (value: EvaluationResult, observed: ObservedDecision, facts: PushFacts): EvaluationResult["decisionMatch"] => {
  // 관측되지 않은 재개 방식은 비교 보류
  if (value.decision === "INCONCLUSIVE" || value.decision === "OUT_OF_SCOPE" ||
      observed.restartType === "UNKNOWN" || value.restart === null || value.restart === "UNKNOWN") return "UNDETERMINED";
  // 재개 방식이 다르면 불일치
  if (observed.restartType !== value.restart) return "MISMATCH";
  // 카드 관측이 없으면 전체 비교 보류
  if (observed.card === null) return "UNDETERMINED";
  // 계산되지 않은 징계를 카드 없음으로 바꾸지 않는다.
  if (value.disciplinary === null) return "UNDETERMINED";
  const disciplinary = value.disciplinary;
  // 확인된 카드가 다르면 불일치
  if (observed.card !== disciplinary) return "MISMATCH";
  const role = facts.context?.offenderRole.value;
  const beneficiary = value.restart === "PLAY_CONTINUED" ? "NONE"
    : role === "ATTACKING_TEAM" ? "DEFENDING_TEAM"
    : role === "DEFENDING_TEAM" ? "ATTACKING_TEAM" : "UNKNOWN";
  if (beneficiary === "UNKNOWN" || observed.restartBeneficiary === "UNKNOWN") return "UNDETERMINED";
  if (observed.restartBeneficiary !== beneficiary) return "MISMATCH";
  // 밀기 평가는 득점의 적합성을 평가하지 않는다.
  if (observed.goalDecision !== "NOT_APPLICABLE") return "UNDETERMINED";
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
    const factSignatureInput = JSON.stringify({ push: input.push, variable: input.variable, observed: input.observed });
    // 사실 입력 해시 생성
    const factSignature = hex(await hash(factSignatureInput));
    // 통합 판정 결과 반환
    return {
      kind: "EVALUATED",
      value: {
        ...pushing,
        decisionMatch: comparison(pushing, input.observed, input.push),
        varAssessment: varValue.assessment,
        factSignature,
        factSignatureInput,
        citations: citations(pushing, varValue),
      },
    };
  };
