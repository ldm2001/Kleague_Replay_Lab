import type { ConceptKey, RuleSet } from "../../../shared/rule-set";
import type { RuleCitation } from "../../../shared/citation";
import type { IncidentAssertion, IncidentRecordV1 } from "../../../shared/incident-record";
import type { IncidentConclusion, IncidentEvaluationV1, IncidentFactDiagnostic, IncidentQuestion } from "../../../shared/incident-evaluation";
import { incidentRecordData } from "../../../shared/incident-validation";
import { incidentAdmissionMatches, incidentRecordSignature, readIncidentAssertion, type IncidentAdmission, type IncidentAssertionRead } from "./evidence";

type PendingState = "UNDETERMINED" | "UNSUPPORTED" | "NOT_APPLICABLE";
const pending = (status: PendingState, reason: string, missingFacts: readonly string[] = [], citations: readonly RuleCitation[] = []): IncidentConclusion<never> =>
  ({ status, value: null, reasonCodes: [reason], missingFacts, citations });
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const completed = <T>(value: T, reads: readonly IncidentAssertionRead[], citations: readonly RuleCitation[]): IncidentConclusion<T> => ({
  status: "COMPLETED", value, factIds: unique(reads.flatMap((read) => read.factIds)),
  evidenceIds: unique(reads.flatMap((read) => read.evidenceIds)), citations,
});

export const evaluateHolding = (record: IncidentRecordV1, actionId: string, input: Readonly<{ rules: RuleSet; admission: IncidentAdmission }>): IncidentEvaluationV1 => {
  if (!incidentRecordData(record)) throw new Error("INCIDENT_RECORD_INVALID");
  const action = record.actions.find((action) => action.id === actionId);
  if (!action) throw new Error("INCIDENT_ACTION_NOT_FOUND");
  const diagnostics: IncidentFactDiagnostic[] = [];
  const result: IncidentEvaluationV1 = {
    schemaVersion: "incident-evaluation-v1", evaluatorVersion: "holding-criteria-v2", incidentId: record.incidentId,
    actionId, sourceSha256: record.sourceSha256, recordSha256: incidentRecordSignature(record),
    ruleVersionId: record.match.ifabVersionId, scope: "HOLDING_ONLY", factDiagnostics: diagnostics,
    conclusions: {
      offence: pending("UNSUPPORTED", "ACTION_EVALUATOR_UNSUPPORTED"),
      risk: pending("UNSUPPORTED", "RISK_EVALUATOR_UNSUPPORTED"),
      restart: pending("UNSUPPORTED", "ACTION_EVALUATOR_UNSUPPORTED"),
      disciplinary: pending("UNSUPPORTED", "DISCIPLINARY_EVALUATOR_UNSUPPORTED"),
      originalDecisionComparison: pending("UNSUPPORTED", "ORIGINAL_DECISION_COMPARISON_UNSUPPORTED"),
      varIntervention: pending("UNSUPPORTED", "VAR_EVALUATOR_UNSUPPORTED"),
    },
  };
  if (action.type !== "HOLDING_MOTION") return result;
  const stopBoth = (reason: string, missing: readonly string[] = []): IncidentEvaluationV1 => {
    result.conclusions.offence = pending("UNDETERMINED", reason, missing);
    result.conclusions.restart = pending("UNDETERMINED", reason, missing);
    return result;
  };
  if (!incidentAdmissionMatches(record, input.admission)) return stopBoth("ADMISSION_RECORD_MISMATCH");
  if (record.match.verification !== "VERIFIED") return stopBoth("RULE_CONTEXT_UNVERIFIED");
  const cite = (keys: readonly ConceptKey[]): RuleCitation[] | null => {
    const groups = keys.map((key) => input.rules.cite(key));
    if (groups.some((group) => !group.length)) return null;
    const citations = groups.flat();
    return citations.every((citation) => citation.authority === "IFAB" &&
      `ifab-${citation.edition}` === record.match.ifabVersionId) ? citations : null;
  };
  const offenceCitations = cite(["LAW_12_HOLDING_DEFINITION", "LAW_12_HOLDING_OFFENCE", "LAW_12_IN_PLAY"]);
  if (!offenceCitations) return stopBoth("RULE_CLAUSE_OR_EDITION_UNAVAILABLE");
  result.conclusions.risk = pending("NOT_APPLICABLE", "SEVERITY_NOT_A_HOLDING_ESTABLISHMENT_CONDITION", [], offenceCitations);
  const read = (fact: IncidentAssertion, temporal = false) => {
    const outcome = readIncidentAssertion(record, action, fact, input.admission, { temporal });
    if (!diagnostics.some((item) => item.factId === fact.id && item.temporal === temporal)) {
      diagnostics.push({ factId: fact.id, state: outcome.state, temporal, evidenceIds: outcome.evidenceIds, reasons: outcome.reasons });
    }
    return outcome;
  };
  const context = action.context;
  const actionRead = read(action.observations.actionObserved);
  const playerRead = read(context.actorIsPlayer), targetRead = read(context.targetIsPlayer), opponentRead = read(context.opponents);
  const inPlayRead = read(context.ballInPlay, true);
  const applicable = [actionRead, playerRead, targetRead, opponentRead, inPlayRead];
  const applicableFacts = [action.observations.actionObserved, context.actorIsPlayer, context.targetIsPlayer, context.opponents, context.ballInPlay];
  const unresolved = applicable.flatMap((read, index) => read.state === "UNKNOWN" || read.state === "NOT_APPLICABLE" ? [applicableFacts[index]!.id] : []);
  if (unresolved.length) return stopBoth("HOLDING_CONTEXT_UNDETERMINED", unresolved);
  if (applicable.some((read) => read.state !== "CONFIRMED")) {
    result.conclusions.offence = pending("UNSUPPORTED", "OUTSIDE_IN_PLAY_OPPONENT_HOLDING_SCOPE", [], offenceCitations);
    result.conclusions.restart = pending("UNSUPPORTED", "OUTSIDE_IN_PLAY_OPPONENT_HOLDING_SCOPE");
    return result;
  }
  const actor = record.actors.find((actor) => actor.id === action.actorId)!;
  const target = record.actors.find((actor) => actor.id === action.targetActorId)!;
  const actorTeam = read(actor.teamAssignment), targetTeam = read(target.teamAssignment);
  if (actorTeam.state === "CONFIRMED" && targetTeam.state === "CONFIRMED" && actor.teamId === target.teamId) {
    return stopBoth("TEAM_RELATION_CONFLICT", [context.opponents.id, actor.teamAssignment.id, target.teamAssignment.id]);
  }
  const contact = read(action.observations.bodyOrEquipmentContact, action.observations.bodyOrEquipmentContact.state === "REFUTED");
  const impeded = read(action.observations.movementImpeded, true);
  const grip = read(action.observations.gripMaintained, true);
  const pulling = read(action.observations.pulling, true);
  // These claims concern this action's contact with the same target. They are
  // optional corroboration, never new mandatory holding conditions.
  const conflicting = [impeded, grip, pulling].filter((item) => item.state === "CONFIRMED");
  if (contact.state === "REFUTED" && conflicting.length) {
    const ids = new Set([action.observations.bodyOrEquipmentContact.id, ...conflicting.flatMap((item) => item.factIds)]);
    for (const item of diagnostics) {
      if (ids.has(item.factId)) item.reasons = unique([...item.reasons, "OBSERVATION_CONFLICT"]);
    }
    return stopBoth("OBSERVATION_CONFLICT");
  }
  if (contact.state === "REFUTED" || impeded.state === "REFUTED") {
    result.conclusions.offence = completed("NO_HOLDING_OFFENCE", [...applicable, contact.state === "REFUTED" ? contact : impeded], offenceCitations);
    result.conclusions.restart = pending("NOT_APPLICABLE", "NO_HOLDING_OFFENCE_TO_RESTART", [], offenceCitations);
    return result;
  }
  if (contact.state !== "CONFIRMED" || impeded.state !== "CONFIRMED") {
    return stopBoth("HOLDING_FACTS_UNDETERMINED", [
      ...(contact.state !== "CONFIRMED" ? [action.observations.bodyOrEquipmentContact.id] : []),
      ...(impeded.state !== "CONFIRMED" ? [action.observations.movementImpeded.id] : []),
    ]);
  }
  const offenceReads = [...applicable, contact, impeded];
  result.conclusions.offence = completed("HOLDING_OFFENCE", offenceReads, offenceCitations);
  if (record.actions.some((other) => other.id !== action.id && other.observations.actionObserved.state === "CONFIRMED" &&
      input.admission.factIds.has(other.observations.actionObserved.id))) {
    result.conclusions.restart = pending("UNSUPPORTED", "MULTI_ACTION_RESTART_SELECTION_UNSUPPORTED");
    return result;
  }
  const restartCitations = cite(["LAW_12_IN_PLAY", "LAW_13_BENEFICIARY", "LAW_14_PENALTY", "LAW_12_CONTINUING_HOLDING", "LAW_5_ADVANTAGE", "LAW_5_MULTIPLE_OFFENCES"]);
  if (!restartCitations) {
    result.conclusions.restart = pending("UNDETERMINED", "RESTART_RULE_CLAUSE_OR_EDITION_UNAVAILABLE");
    return result;
  }
  const restartFacts = [context.onField, context.insideOwnPenaltyArea, context.stoppedForThisAction, context.advantageApplied, context.otherActionInRestartSequence, target.teamAssignment];
  const restartReads = restartFacts.map((fact) => read(fact, fact !== target.teamAssignment));
  const missing = restartReads.flatMap((read, index) => read.state === "UNKNOWN" || read.state === "NOT_APPLICABLE" ? [restartFacts[index]!.id] : []);
  if (missing.length || targetTeam.state !== "CONFIRMED" || !target.teamId) {
    result.conclusions.restart = pending("UNDETERMINED", "RESTART_FACTS_UNDETERMINED", unique([...missing,
      ...(targetTeam.state !== "CONFIRMED" || !target.teamId ? [target.teamAssignment.id] : [])]), restartCitations);
    return result;
  }
  const [onField, inside, stopped, advantage, competing] = restartReads;
  if (onField!.state !== "CONFIRMED" || stopped!.state !== "CONFIRMED" || advantage!.state !== "REFUTED" || competing!.state !== "REFUTED") {
    result.conclusions.restart = pending("UNSUPPORTED", "RESTART_CONTEXT_REQUIRES_SEPARATE_EVALUATOR", [], restartCitations);
    return result;
  }
  result.conclusions.restart = completed({ type: inside!.state === "CONFIRMED" ? "PENALTY_KICK" : "DIRECT_FREE_KICK", beneficiaryTeamId: target.teamId },
    [...offenceReads, ...restartReads], [...offenceCitations, ...restartCitations]);
  return result;
};

export const publicIncidentConclusions = (result: IncidentEvaluationV1) => {
  const entries = Object.entries(result.conclusions) as [IncidentQuestion, IncidentEvaluationV1["conclusions"][IncidentQuestion]][];
  return { schemaVersion: result.schemaVersion, evaluatorVersion: result.evaluatorVersion, scope: result.scope,
    incidentId: result.incidentId, actionId: result.actionId, ruleVersionId: result.ruleVersionId,
    conclusions: entries.flatMap(([question, conclusion]) => conclusion.status === "COMPLETED"
      ? [{ question, value: conclusion.value, evidenceIds: conclusion.evidenceIds, citations: conclusion.citations }] : []),
    notAssessed: entries.filter(([, conclusion]) => conclusion.status !== "COMPLETED").map(([question]) => question),
  };
};
