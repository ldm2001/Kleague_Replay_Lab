import type { Clock } from "../../ports/clock/clock";
import type { EvaluationRepo, DecisionSaveResult } from "../../ports/repositories/evaluation-repo";
import type { EvaluationResult } from "@replay/shared-types";
import type { EvaluateInput, EvaluateResult } from "./evaluate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DecisionInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  candidateId: string;
}>;

export type DecisionDependencies = Readonly<{
  clock: Clock;
  repository: EvaluationRepo;
  run: (input: EvaluateInput) => Promise<EvaluateResult>;
}>;

export type DecisionResult =
  | DecisionSaveResult
  | Readonly<{ kind: "INVALID_INPUT"; reason: "ID" }>
  | Readonly<{ kind: "NO_FACTS" | "RULE_VERSION_UNKNOWN" | "EVALUATION_FAILED"; message?: string }>;

export const decision =
  ({ clock, repository, run }: DecisionDependencies) =>
  async (input: DecisionInput): Promise<DecisionResult> => {
    if (![input.anonymousSessionId, input.analysisId, input.candidateId].every((value) => UUID.test(value))) {
      return { kind: "INVALID_INPUT", reason: "ID" };
    }
    const context = await repository.context({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      analysisId: input.analysisId.toLowerCase(),
      candidateId: input.candidateId.toLowerCase(),
      now: clock.now().toISOString(),
    });
    if (context.kind !== "READY") {
      if (context.kind === "NO_FACTS") return { kind: "NO_FACTS" };
      if (context.kind === "RULE_VERSION_UNAVAILABLE") return { kind: "RULE_VERSION_UNKNOWN" };
      return { kind: "EVALUATION_FAILED", message: "candidate-not-found" };
    }
    const result = await run({
      ruleVersionId: context.value.ruleVersionId,
      push: context.value.facts.push,
      variable: context.value.facts.variable,
      options: context.value.competitionOptions,
    });
    if (result.kind !== "EVALUATED") {
      return result.kind === "RULE_VERSION_UNKNOWN"
        ? { kind: "RULE_VERSION_UNKNOWN" }
        : { kind: "EVALUATION_FAILED", message: result.message };
    }
    return repository.save({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      analysisId: input.analysisId.toLowerCase(),
      candidateId: input.candidateId.toLowerCase(),
      factRevisionId: context.value.factRevisionId,
      ruleVersionId: context.value.ruleVersionDbId,
      facts: context.value.facts,
      evaluation: result.value as EvaluationResult,
      ruleEngineVersion: "rule-engine-v1",
      evaluationSchemaVersion: 1,
      now: clock.now().toISOString(),
    });
  };
