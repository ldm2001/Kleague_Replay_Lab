import { pgEnum } from "drizzle-orm/pg-core";

const values = <T extends readonly [string, ...string[]]>(items: T): T => items;

export const videoAssetStatus = pgEnum(
  "video_asset_status",
  values(["CREATED", "UPLOADING", "VALIDATING", "VALID", "REJECTED", "EXPIRED", "DELETED"]),
);
export const retentionClass = pgEnum("retention_class", values(["TEMPORARY", "CURATED"]));
export const jobType = pgEnum(
  "job_type",
  values(["VALIDATE_VIDEO", "ANALYZE_VIDEO", "DELETE_VIDEO_ASSET", "PURGE_ANALYSIS"]),
);
export const jobStatus = pgEnum("job_status", values(["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED"]));
export const idempotencyOperation = pgEnum("idempotency_operation", values(["CREATE_ANALYSIS", "PATCH_FACTS"]));
export const reviewScenario = pgEnum(
  "review_scenario",
  values([
    "GOAL_DISALLOWED",
    "GOAL_AWARDED",
    "PENALTY_NOT_GIVEN",
    "PENALTY_GIVEN",
    "SENDING_OFF_NOT_GIVEN",
    "CARD_SHOWN",
    "SECOND_CAUTION",
    "CORNER_KICK_AWARDED",
    "OTHER",
  ]),
);
export const cameraSufficiency = pgEnum("camera_sufficiency", values(["LOW", "MEDIUM", "HIGH"]));
export const candidateReviewStatus = pgEnum(
  "candidate_review_status",
  values(["UNREVIEWED", "CONFIRMED", "DISMISSED"]),
);
export const playbackSpeed = pgEnum("playback_speed", values(["NORMAL", "SLOW", "UNKNOWN"]));
export const factSource = pgEnum("fact_source", values(["MODEL", "USER", "CURATOR"]));
export const evidenceKind = pgEnum("evidence_kind", values(["FRAME", "CLIP"]));
export const observedRestartType = pgEnum(
  "observed_restart_type",
  values([
    "DIRECT_FREE_KICK",
    "INDIRECT_FREE_KICK",
    "FREE_KICK_UNSPECIFIED",
    "PENALTY_KICK",
    "DROP_BALL",
    "THROW_IN",
    "GOAL_KICK",
    "CORNER_KICK",
    "KICK_OFF",
    "PLAY_CONTINUED",
    "UNKNOWN",
  ]),
);
export const observedRestartBeneficiary = pgEnum(
  "observed_restart_beneficiary",
  values(["ATTACKING_TEAM", "DEFENDING_TEAM", "NONE", "UNKNOWN"]),
);
export const observedGoalDecision = pgEnum(
  "observed_goal_decision",
  values(["GOAL", "NO_GOAL", "NOT_APPLICABLE", "UNKNOWN"]),
);
export const observedSource = pgEnum(
  "observed_source",
  values(["RESTART_INFERRED", "REFEREE_SIGNAL", "VAR_OFR", "USER_INPUT", "MATCH_REPORT"]),
);
export const decisionMatch = pgEnum("decision_match", values(["MATCH", "MISMATCH", "UNDETERMINED"]));
export const severity = pgEnum("severity", values(["CARELESS", "RECKLESS", "EXCESSIVE_FORCE"]));
export const varCategory = pgEnum(
  "var_category",
  values(["GOAL_NO_GOAL", "PENALTY_NO_PENALTY", "RED_CARD", "MISTAKEN_IDENTITY", "CORNER_KICK", "NONE"]),
);
export const varThresholdResult = pgEnum(
  "var_threshold_result",
  values(["MET", "NOT_MET", "UNDETERMINED"]),
);
export const varIntervention = pgEnum(
  "var_intervention",
  values(["NO_INTERVENTION", "OVERTURNED", "CONFIRMED"]),
);
export const varNoInterventionReason = pgEnum(
  "var_no_intervention_reason",
  values(["NOT_REVIEWABLE", "TOO_LATE", "THRESHOLD_NOT_MET"]),
);
export const varNotReviewableReason = pgEnum(
  "var_not_reviewable_reason",
  values(["OUTSIDE_REVIEWABLE_CATEGORIES", "COMPETITION_OPTION_NOT_ADOPTED"]),
);
export const varWindowClosedReason = pgEnum("var_window_closed_reason", values(["PLAY_RESTARTED"]));
export const varWindowException = pgEnum(
  "var_window_exception",
  values(["MISTAKEN_IDENTITY", "VIOLENT_CONDUCT", "BITING_OR_SPITTING", "OFFENSIVE_LANGUAGE_OR_ACTION", "NONE"]),
);
export const disciplinaryAction = pgEnum(
  "disciplinary_action",
  values(["NONE", "CAUTION", "SECOND_CAUTION", "SEND_OFF"]),
);
export const foulDecision = pgEnum(
  "foul_decision",
  values(["FOUL", "NO_FOUL", "NORMAL_CONTACT", "INCONCLUSIVE", "OUT_OF_SCOPE"]),
);
export const varReviewProcedure = pgEnum("var_review_procedure", values(["OFR", "VAR_ONLY", "NONE"]));
export const inconclusiveReason = pgEnum(
  "inconclusive_reason",
  values(["CAMERA_INSUFFICIENT", "SEVERITY_UNDETERMINED", "SLOW_MOTION_ONLY", "OUT_OF_SCOPE"]),
);
export const announcedBy = pgEnum(
  "announced_by",
  values(["KFA_REFEREE_COMMITTEE", "COMPETITION_ORGANISER", "OTHER"]),
);
export const officialVerdictValue = pgEnum(
  "official_verdict_value",
  values(["CORRECT", "INCORRECT", "NO_COMMENT"]),
);
export const officialVerdictStatus = pgEnum("official_verdict_status", values(["EXTERNAL_OPINION"]));
