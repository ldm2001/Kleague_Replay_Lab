import type {
  CompetitionOptions,
  EvaluationResult,
  PushFacts,
  RuleSet,
  VarFacts,
  VarOutcome,
} from "@replay/shared-types";

type Rule = (versionId: string) => RuleSet | null;
type Push = (facts: PushFacts, rules: RuleSet) => EvaluationResult;
type Variable = (facts: VarFacts, rules: RuleSet, options: CompetitionOptions) => VarOutcome;
type Hash = (value: string) => Promise<Uint8Array>;

export type AssessmentInput = Readonly<{
  ruleVersionId: string;
  push: PushFacts;
  variable: VarFacts;
  options: CompetitionOptions;
}>;

export type AssessmentResult =
  | Readonly<{ kind: "EVALUATED"; value: EvaluationResult }>
  | Readonly<{ kind: "RULE_VERSION_UNKNOWN" }>
  | Readonly<{ kind: "VAR_EVALUATION_FAILED"; error: string; message: string }>;

export type AssessmentDependencies = Readonly<{
  rule: Rule;
  push: Push;
  variable: Variable;
  hash: Hash;
}>;

// 인용 중복 제거
const citations = (value: EvaluationResult, variable: Extract<VarOutcome, { ok: true }>): EvaluationResult["citations"] => {
  const values = [...value.citations, ...variable.citations];
  const seen = new Set<string>();
  return values.filter((item) => {
    if (seen.has(item.ruleId)) return false;
    seen.add(item.ruleId);
    return true;
  });
};

// 바이트 해시 변환
const hex = (value: Uint8Array): string => Array.from(value, (item) => item.toString(16).padStart(2, "0")).join("");

// 밀기와 VAR 평가
export const assessment =
  ({ rule, push, variable, hash }: AssessmentDependencies) =>
  async (input: AssessmentInput): Promise<AssessmentResult> => {
    const rules = rule(input.ruleVersionId);
    if (!rules) return { kind: "RULE_VERSION_UNKNOWN" };

    const pushing = push(input.push, rules);
    const varValue = variable(input.variable, rules, input.options);
    if (!varValue.ok) {
      return { kind: "VAR_EVALUATION_FAILED", error: varValue.error, message: varValue.message };
    }

    const factSignatureInput = JSON.stringify({ push: input.push, variable: input.variable });
    const factSignature = hex(await hash(factSignatureInput));
    return {
      kind: "EVALUATED",
      value: {
        ...pushing,
        varAssessment: varValue.assessment,
        factSignature,
        factSignatureInput,
        citations: citations(pushing, varValue),
      },
    };
  };
