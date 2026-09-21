import type { RuleCitation } from "./citation";
import type { DecisionMatch, DisciplinaryAction, Severity, VarIntervention } from "./vocabulary";

export type IncidentConclusion<T> =
  | Readonly<{ status: "COMPLETED"; value: T; factIds: readonly string[]; evidenceIds: readonly string[]; citations: readonly RuleCitation[] }>
  | Readonly<{ status: "UNDETERMINED" | "UNSUPPORTED" | "NOT_APPLICABLE"; value: null;
      missingFacts: readonly string[]; reasonCodes: readonly string[]; citations: readonly RuleCitation[] }>;

export interface IncidentEvaluationV1 {
  schemaVersion: "incident-evaluation-v1";
  evaluatorVersion: "holding-criteria-v1";
  incidentId: string;
  actionId: string;
  sourceSha256: string;
  recordSha256: string;
  ruleVersionId: string | null;
  scope: "HOLDING_ONLY";
  conclusions: {
    offence: IncidentConclusion<"HOLDING_OFFENCE" | "NO_HOLDING_OFFENCE">;
    risk: IncidentConclusion<Severity>;
    restart: IncidentConclusion<{ type: "DIRECT_FREE_KICK" | "PENALTY_KICK"; beneficiaryTeamId: string }>;
    disciplinary: IncidentConclusion<DisciplinaryAction>;
    originalDecisionComparison: IncidentConclusion<DecisionMatch>;
    varIntervention: IncidentConclusion<VarIntervention>;
  };
}

export type IncidentQuestion = keyof IncidentEvaluationV1["conclusions"];
