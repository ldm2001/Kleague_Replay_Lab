import type { RuleCitation } from "./citation";
import type { DecisionMatch, DisciplinaryAction, Severity, VarIntervention } from "./vocabulary";
import type { IncidentAssertion } from "./incident-record";

export interface IncidentFactDiagnostic {
  factId: string;
  state: IncidentAssertion["state"];
  temporal: boolean;
  evidenceIds: readonly string[];
  reasons: readonly string[];
}

export type IncidentConclusion<T> =
  | Readonly<{ status: "COMPLETED"; value: T; factIds: readonly string[]; evidenceIds: readonly string[]; citations: readonly RuleCitation[] }>
  | Readonly<{ status: "UNDETERMINED" | "UNSUPPORTED" | "NOT_APPLICABLE"; value: null;
      missingFacts: readonly string[]; reasonCodes: readonly string[]; citations: readonly RuleCitation[] }>;

export interface IncidentEvaluationV1 {
  schemaVersion: "incident-evaluation-v1";
  evaluatorVersion: "holding-criteria-v2";
  incidentId: string;
  actionId: string;
  sourceSha256: string;
  recordSha256: string;
  ruleVersionId: string | null;
  scope: "HOLDING_ONLY";
  // Private read outcomes, not raw claims or public conclusions.
  factDiagnostics: readonly IncidentFactDiagnostic[];
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
