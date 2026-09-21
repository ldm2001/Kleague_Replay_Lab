import type { DisciplinaryAction, GoalDecision, RestartType } from "./vocabulary";

/** Producer claims only: neither confidence nor structural validity admits a rule fact. */
export interface IncidentAssertion {
  id: string;
  state: "CONFIRMED" | "REFUTED" | "UNKNOWN" | "NOT_APPLICABLE";
  origin: "IMAGE_MEASUREMENT" | "MODEL_ESTIMATE" | "EVENT_LINK";
  method: { id: string; version: string };
  evidenceIds: readonly string[];
  confidence: number | null;
  reasons: readonly string[];
}
/** Source presentation timestamps, not inferred match-clock time. */
export interface IncidentSegment {
  id: string; shotId: string; cameraId: string | null; startMs: number; endMs: number;
  playbackSpeed: "NORMAL" | "SLOW" | "UNKNOWN";
  replayState: "LIVE" | "REPLAY" | "UNKNOWN";
  matchClockMs: number | null;
}
export interface IncidentEvidence {
  id: string; segmentId: string; kind: "FRAME" | "CLIP"; startMs: number; endMs: number; contentSha256: string;
}
export interface IncidentActor {
  id: string;
  tracklets: readonly { segmentId: string; continuityId: string; trackId: string }[];
  /** An assigned identity, not a candidate: non-null only with a CONFIRMED producer claim. */
  teamId: string | null; teamAssignment: IncidentAssertion;
}
export interface IncidentLink {
  id: string; firstSegmentId: string; secondSegmentId: string;
  relation: "SAME_INCIDENT" | "BEFORE" | "AFTER" | "SIMULTANEOUS";
  assessment: IncidentAssertion;
}
export interface IncidentMatch {
  matchId: string | null; competition: string | null; season: string | null; matchDate: string | null;
  ifabVersionId: string | null; verification: "VERIFIED" | "UNVERIFIED";
}
/** Response/sequence claims concern observed actions, not established offences or rule priority. */
export const INCIDENT_CONTEXT_KEYS = Object.freeze(["actorIsPlayer", "targetIsPlayer", "opponents", "ballInPlay", "onField", "insideOwnPenaltyArea", "stoppedForThisAction", "advantageApplied", "otherActionInRestartSequence"] as const);
export const INCIDENT_OBSERVATION_KEYS = {
  PUSHING_MOTION: ["actionObserved", "bodyContact", "extensionTowardOpponent", "opponentMotionChanged"],
  TACKLE_MOTION: ["actionObserved", "opponentContact", "ballContact", "ballContactBeforeOpponent", "legExtended", "footRaised", "challengingForBall"],
  HOLDING_MOTION: ["actionObserved", "bodyOrEquipmentContact", "gripMaintained", "pulling", "movementImpeded"],
  CHARGING_MOTION: ["actionObserved", "bodyContact", "shoulderContact", "approachFromSide", "challengingForBall"],
  HAND_ARM_BALL_CONTACT: ["actionObserved", "ballHandArmContact", "armMovesTowardBall", "armPositionObserved", "bodyMotionObserved", "directGoalByActor", "immediateGoalByActor"],
} as const;
export type IncidentActionType = keyof typeof INCIDENT_OBSERVATION_KEYS;
export type IncidentContext = { [K in typeof INCIDENT_CONTEXT_KEYS[number]]: IncidentAssertion };
export interface IncidentMeasurement extends Omit<IncidentAssertion, "state"> {
  quantity: "IMAGE_DISTANCE" | "IMAGE_SPEED" | "ANGLE" | "DURATION";
  value: number | null; unit: "px" | "px_per_s" | "deg" | "ms"; state: "KNOWN" | "UNKNOWN";
}
export type IncidentAction = { [T in IncidentActionType]: {
  id: string; type: T; actorId: string; targetActorId: string | null;
  segmentId: string; startMs: number; endMs: number;
  context: IncidentContext;
  observations: { [K in typeof INCIDENT_OBSERVATION_KEYS[T][number]]: IncidentAssertion };
  measurements: readonly IncidentMeasurement[];
} }[IncidentActionType];
export interface RefereeDecisionObservation {
  id: string; phase: "INITIAL" | "REVISED" | "FINAL" | "UNKNOWN";
  segmentId: string; startMs: number; endMs: number;
  /** Each value is non-null exactly when its corresponding observation is CONFIRMED. */
  restartType: RestartType | null; restartBeneficiaryTeamId: string | null;
  card: DisciplinaryAction | null; goalDecision: GoalDecision | null;
  observations: { restart: IncidentAssertion; beneficiary: IncidentAssertion; card: IncidentAssertion; goal: IncidentAssertion };
}
export interface IncidentRecordV1 {
  schemaVersion: "incident-record-v1"; incidentId: string; sourceSha256: string;
  match: IncidentMatch; segments: readonly IncidentSegment[]; evidence: readonly IncidentEvidence[];
  actors: readonly IncidentActor[]; links: readonly IncidentLink[]; actions: readonly IncidentAction[];
  refereeDecisions: readonly RefereeDecisionObservation[];
}
