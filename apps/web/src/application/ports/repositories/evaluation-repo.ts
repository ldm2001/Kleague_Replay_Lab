import type { EvaluationFacts } from "@replay/shared-types";
import type { EvaluationResult } from "@replay/shared-types";

export type FactPatchCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  candidateId: string;
  expectedFactRevisionId: string | null;
  facts: EvaluationFacts;
  keyHash: Uint8Array;
  requestHash: Uint8Array;
  now: string;
}>;

export type FactPatchResult =
  | Readonly<{ kind: "CREATED" | "REPLAYED"; factRevisionId: string; revision: number }>
  | Readonly<{ kind: "STALE_FACT_REVISION" }>
  | Readonly<{ kind: "IDEMPOTENCY_KEY_REUSED" }>
  | Readonly<{ kind: "NOT_FOUND" }>;

export type EvaluationContextCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  candidateId: string;
  now: string;
}>;

export type EvaluationContext = Readonly<{
  analysisId: string;
  analysisStateVersion: number;
  candidateId: string;
  factRevisionId: string;
  facts: EvaluationFacts;
  ruleVersionId: string;
  ruleVersionDbId: string;
  competitionOptions: Readonly<Record<string, boolean | undefined>>;
}>;

export type EvaluationContextResult =
  | Readonly<{ kind: "READY"; value: EvaluationContext }>
  | Readonly<{ kind: "NO_FACTS" | "RULE_VERSION_UNAVAILABLE" | "NOT_FOUND" }>;

export type DecisionSaveCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  analysisStateVersion: number;
  candidateId: string;
  factRevisionId: string;
  ruleVersionId: string;
  facts: EvaluationFacts;
  evaluation: EvaluationResult;
  ruleEngineVersion: string;
  evaluationSchemaVersion: number;
  now: string;
}>;

export type DecisionSaveResult =
  | Readonly<{ kind: "CREATED" | "REPLAYED"; decisionId: string }>
  | Readonly<{ kind: "NOT_FOUND" | "FACT_NOT_FOUND" | "RULE_VERSION_UNAVAILABLE" }>;

export type EvaluationRepo = Readonly<{
  patch: (command: FactPatchCommand) => Promise<FactPatchResult>;
  context: (command: EvaluationContextCommand) => Promise<EvaluationContextResult>;
  save: (command: DecisionSaveCommand) => Promise<DecisionSaveResult>;
}>;
