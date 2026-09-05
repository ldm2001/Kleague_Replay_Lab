import { pgEnum } from "drizzle-orm/pg-core";

// 열거값 타입 고정
const values = <T extends readonly [string, ...string[]]>(items: T): T => items;

// 영상 자산 상태
export const videoAssetStatus = pgEnum(
  "video_asset_status",
  values(["CREATED", "UPLOADING", "VALIDATING", "VALID", "REJECTED", "EXPIRED", "DELETED"]),
);
// 업로드 의도 상태
export const uploadIntentStatus = pgEnum(
  "upload_intent_status",
  values(["CREATED", "UPLOADING", "COMPLETED", "EXPIRED", "REJECTED"]),
);
// 보존 등급
export const retentionClass = pgEnum("retention_class", values(["TEMPORARY", "CURATED"]));
// 작업 유형
export const jobType = pgEnum(
  "job_type",
  values(["VALIDATE_VIDEO", "ANALYZE_VIDEO", "DELETE_VIDEO_ASSET", "PURGE_ANALYSIS"]),
);
// 작업 상태
export const jobStatus = pgEnum("job_status", values(["QUEUED", "PROCESSING", "SUCCEEDED", "FAILED"]));
// 작업 단계
export const jobStage = pgEnum(
  "job_stage",
  values(["QUEUED", "VALIDATING", "SEGMENTING", "DETECTING", "EXTRACTING_FACTS", "BUILDING_EVIDENCE", "APPLYING_RULES", "SUCCEEDED", "FAILED"]),
);
// 작업 이벤트 종류
export const jobEventType = pgEnum("job_event_type", values(["CLAIMED", "PROGRESS", "HEARTBEAT", "SUCCEEDED", "FAILED"]));
// 멱등 작업 종류
export const idempotencyOperation = pgEnum("idempotency_operation", values(["CREATE_ANALYSIS", "PATCH_FACTS"]));
// 검토 대상 상황
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
// 카메라 충족도
export const cameraSufficiency = pgEnum("camera_sufficiency", values(["LOW", "MEDIUM", "HIGH"]));
// 후보 검토 상태
export const candidateReviewStatus = pgEnum(
  "candidate_review_status",
  values(["UNREVIEWED", "CONFIRMED", "DISMISSED"]),
);
// 재생 속도
export const playbackSpeed = pgEnum("playback_speed", values(["NORMAL", "SLOW", "UNKNOWN"]));
// 사실 출처
export const factSource = pgEnum("fact_source", values(["MODEL", "USER", "CURATOR"]));
// 증거 종류
export const evidenceKind = pgEnum("evidence_kind", values(["FRAME", "CLIP"]));
// 관측 재개 방식
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
// 관측 재개 주체
export const observedRestartBeneficiary = pgEnum(
  "observed_restart_beneficiary",
  values(["ATTACKING_TEAM", "DEFENDING_TEAM", "NONE", "UNKNOWN"]),
);
// 관측 득점 판정
export const observedGoalDecision = pgEnum(
  "observed_goal_decision",
  values(["GOAL", "NO_GOAL", "NOT_APPLICABLE", "UNKNOWN"]),
);
// 관측 판정 출처
export const observedSource = pgEnum(
  "observed_source",
  values(["RESTART_INFERRED", "REFEREE_SIGNAL", "VAR_OFR", "USER_INPUT", "MATCH_REPORT"]),
);
// 판정 일치 여부
export const decisionMatch = pgEnum("decision_match", values(["MATCH", "MISMATCH", "UNDETERMINED"]));
// 접촉 강도
export const severity = pgEnum("severity", values(["CARELESS", "RECKLESS", "EXCESSIVE_FORCE"]));
// VAR 검토 범주
export const varCategory = pgEnum(
  "var_category",
  values(["GOAL_NO_GOAL", "PENALTY_NO_PENALTY", "RED_CARD", "MISTAKEN_IDENTITY", "CORNER_KICK", "NONE"]),
);
// VAR 문턱 결과
export const varThresholdResult = pgEnum(
  "var_threshold_result",
  values(["MET", "NOT_MET", "UNDETERMINED"]),
);
// VAR 개입 결과
export const varIntervention = pgEnum(
  "var_intervention",
  values(["NO_INTERVENTION", "OVERTURNED", "CONFIRMED"]),
);
// VAR 미개입 사유
export const varNoInterventionReason = pgEnum(
  "var_no_intervention_reason",
  values(["NOT_REVIEWABLE", "TOO_LATE", "THRESHOLD_NOT_MET"]),
);
// VAR 범위 밖 사유
export const varNotReviewableReason = pgEnum(
  "var_not_reviewable_reason",
  values(["OUTSIDE_REVIEWABLE_CATEGORIES", "COMPETITION_OPTION_NOT_ADOPTED"]),
);
// VAR 시간 창 종료 사유
export const varWindowClosedReason = pgEnum("var_window_closed_reason", values(["PLAY_RESTARTED"]));
// VAR 시간 창 예외
export const varWindowException = pgEnum(
  "var_window_exception",
  values(["MISTAKEN_IDENTITY", "VIOLENT_CONDUCT", "BITING_OR_SPITTING", "OFFENSIVE_LANGUAGE_OR_ACTION", "NONE"]),
);
// 징계 조치
export const disciplinaryAction = pgEnum(
  "disciplinary_action",
  values(["NONE", "CAUTION", "SECOND_CAUTION", "SEND_OFF"]),
);
// 파울 판정
export const foulDecision = pgEnum(
  "foul_decision",
  values(["FOUL", "NO_FOUL", "NORMAL_CONTACT", "INCONCLUSIVE", "OUT_OF_SCOPE"]),
);
// VAR 검토 절차
export const varReviewProcedure = pgEnum("var_review_procedure", values(["OFR", "VAR_ONLY", "NONE"]));
// 판정 보류 사유
export const inconclusiveReason = pgEnum(
  "inconclusive_reason",
  values(["CAMERA_INSUFFICIENT", "SEVERITY_UNDETERMINED", "SLOW_MOTION_ONLY", "OUT_OF_SCOPE"]),
);
// 공식 판정 발표 주체
export const announcedBy = pgEnum(
  "announced_by",
  values(["KFA_REFEREE_COMMITTEE", "COMPETITION_ORGANISER", "OTHER"]),
);
// 공식 판정 값
export const officialVerdictValue = pgEnum(
  "official_verdict_value",
  values(["CORRECT", "INCORRECT", "NO_COMMENT"]),
);
// 공식 판정 상태
export const officialVerdictStatus = pgEnum("official_verdict_status", values(["EXTERNAL_OPINION"]));
