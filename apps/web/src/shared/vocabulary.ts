// 판본과 무관한 어휘 소유

const vocabulary = <const T extends readonly string[]>(values: T): Readonly<T> =>
  // 어휘 목록 불변화
  Object.freeze(values);

// 규정 기관 목록
export const AUTHORITIES = vocabulary(["IFAB", "KFA", "KLEAGUE"]);
export type Authority = (typeof AUTHORITIES)[number];

// 판정 결과 목록
export const DECISIONS = vocabulary([
  "FOUL",
  "NO_FOUL",
  "NORMAL_CONTACT",
  // 영상 근거 부족
  "INCONCLUSIVE",
  // 규정 조문 없음
  "OUT_OF_SCOPE",
]);
export type Decision = (typeof DECISIONS)[number];

// 접촉 강도 목록
export const SEVERITIES = vocabulary(["CARELESS", "RECKLESS", "EXCESSIVE_FORCE"]);
export type Severity = (typeof SEVERITIES)[number];

// 관측 사실의 강도 값
// 관측 강도 목록
export const OBSERVED_SEVERITIES = vocabulary([...SEVERITIES, "uncertain"]);
export type ObservedSeverity = (typeof OBSERVED_SEVERITIES)[number];

// 밀림 관측 값
// 상대 선수 밀림 목록
export const DISPLACEMENT_LEVELS = vocabulary(["none", "possible", "clear", "uncertain"]);
export type DisplacementLevel = (typeof DISPLACEMENT_LEVELS)[number];

// 관측 속도 목록
export const OBSERVATION_SPEEDS = vocabulary(["NORMAL", "SLOW", "UNKNOWN"]);
export type ObservationSpeed = (typeof OBSERVATION_SPEEDS)[number];

// 인용 관련성 목록
export const RELEVANCES = vocabulary(["PRIMARY", "SUPPORTING", "COUNTER_READING"]);
export type Relevance = (typeof RELEVANCES)[number];

// 사실 상태 목록
export const FACT_STATUSES = vocabulary(["ESTABLISHED", "UNMET"]);
export type FactStatus = (typeof FACT_STATUSES)[number];

// 관측 불확정과 관측 차단 값
export const FACT_BLOCKERS = vocabulary(["CAMERA", "SPEED", "NOT_IN_FOOTAGE"]);
export type FactBlocker = (typeof FACT_BLOCKERS)[number];

// 카메라 충족도 목록
export const CAMERA_SUFFICIENCY_LEVELS = vocabulary(["LOW", "MEDIUM", "HIGH"]);
export type CameraSufficiency = (typeof CAMERA_SUFFICIENCY_LEVELS)[number];

// 관측 재개와 판정 재개 공통 어휘
// 경기 재개 방식 목록
export const RESTART_TYPES = vocabulary([
  "DIRECT_FREE_KICK",
  "INDIRECT_FREE_KICK",
  "FREE_KICK_UNSPECIFIED",
  "PENALTY_KICK",
  "DROP_BALL",
  "THROW_IN",
  "GOAL_KICK",
  "CORNER_KICK",
  "KICK_OFF",
  // 재개 없이 속행
  "PLAY_CONTINUED",
  "UNKNOWN",
]);
export type RestartType = (typeof RESTART_TYPES)[number];

// 재개 혜택 팀 목록
export const RESTART_BENEFICIARIES = vocabulary(["ATTACKING_TEAM", "DEFENDING_TEAM", "NONE", "UNKNOWN"]);
export type RestartBeneficiary = (typeof RESTART_BENEFICIARIES)[number];

// 득점 판정 목록
export const GOAL_DECISIONS = vocabulary(["GOAL", "NO_GOAL", "NOT_APPLICABLE", "UNKNOWN"]);
export type GoalDecision = (typeof GOAL_DECISIONS)[number];

// 관측 카드와 징계 공통 어휘
// 징계 조치 목록
export const DISCIPLINARY_ACTIONS = vocabulary([
  "NONE",
  "CAUTION",
  "SECOND_CAUTION",
  "SEND_OFF",
]);
export type DisciplinaryAction = (typeof DISCIPLINARY_ACTIONS)[number];

// 관측 출처 목록
export const OBSERVED_SOURCES = vocabulary(["RESTART_INFERRED", "REFEREE_SIGNAL", "VAR_OFR", "USER_INPUT", "MATCH_REPORT"]);
export type ObservedSource = (typeof OBSERVED_SOURCES)[number];

// 관측 판정 일치 목록
export const DECISION_MATCHES = vocabulary(["MATCH", "MISMATCH", "UNDETERMINED"]);
export type DecisionMatch = (typeof DECISION_MATCHES)[number];

// 결과 확신도 목록
export const CONFIDENCE_LEVELS = vocabulary(["LOW", "MEDIUM", "HIGH"]);
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// 판정 보류 사유 목록
export const INCONCLUSIVE_REASONS = vocabulary([
  // 각도 부족
  "CAMERA_INSUFFICIENT",
  // 강도 특정 불가
  "SEVERITY_UNDETERMINED",
  // 정상 속도 관측 없음
  "SLOW_MOTION_ONLY",
  // 경기규칙 조문 없음
  "OUT_OF_SCOPE",
]);
export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

// VAR 검토 범주 목록
export const VAR_CATEGORIES = vocabulary([
  "GOAL_NO_GOAL",
  "PENALTY_NO_PENALTY",
  "RED_CARD",
  "MISTAKEN_IDENTITY",
  "CORNER_KICK",
  "NONE",
]);
export type VarCategory = (typeof VAR_CATEGORIES)[number];

// VAR 문턱 결과 목록
export const VAR_THRESHOLD_RESULTS = vocabulary(["MET", "NOT_MET", "UNDETERMINED"]);
export type VarThresholdResult = (typeof VAR_THRESHOLD_RESULTS)[number];

// VAR 개입 결과 목록
export const VAR_INTERVENTIONS = vocabulary(["NO_INTERVENTION", "OVERTURNED", "CONFIRMED"]);
export type VarIntervention = (typeof VAR_INTERVENTIONS)[number];

// 게이트 차단 사유
// VAR 미개입 사유 목록
export const VAR_NO_INTERVENTION_REASONS = vocabulary([
  "NOT_REVIEWABLE",
  "TOO_LATE",
  "THRESHOLD_NOT_MET",
]);
export type VarNoInterventionReason = (typeof VAR_NO_INTERVENTION_REASONS)[number];

// 범주 차단 사유
// VAR 범위 밖 사유 목록
export const VAR_NOT_REVIEWABLE_REASONS = vocabulary([
  "OUTSIDE_REVIEWABLE_CATEGORIES",
  "COMPETITION_OPTION_NOT_ADOPTED",
]);
export type VarNotReviewableReason = (typeof VAR_NOT_REVIEWABLE_REASONS)[number];

// 시한 차단 사유
// VAR 시간 창 종료 사유 목록
export const VAR_WINDOW_CLOSED_REASONS = vocabulary(["PLAY_RESTARTED"]);
export type VarWindowClosedReason = (typeof VAR_WINDOW_CLOSED_REASONS)[number];

// 재개 후 검토 창 예외
// VAR 시간 창 예외 목록
export const VAR_WINDOW_EXCEPTIONS = vocabulary([
  "MISTAKEN_IDENTITY",
  "VIOLENT_CONDUCT",
  "BITING_OR_SPITTING",
  "OFFENSIVE_LANGUAGE_OR_ACTION",
  "NONE",
]);
export type VarWindowException = (typeof VAR_WINDOW_EXCEPTIONS)[number];

// VAR 검토 절차 목록
export const VAR_REVIEW_PROCEDURES = vocabulary(["OFR", "VAR_ONLY", "NONE"]);
export type VarReviewProcedure = (typeof VAR_REVIEW_PROCEDURES)[number];

// 중계에서 관측한 판정 상황
// 중계 검토 상황 목록
export const REVIEW_SCENARIOS = vocabulary([
  "GOAL_DISALLOWED",
  "GOAL_AWARDED",
  "PENALTY_NOT_GIVEN",
  "PENALTY_GIVEN",
  "SENDING_OFF_NOT_GIVEN",
  "CARD_SHOWN",
  "SECOND_CAUTION",
  "CORNER_KICK_AWARDED",
  "OTHER",
]);
export type ReviewScenario = (typeof REVIEW_SCENARIOS)[number];

// 퇴장 범주 묶음
// 퇴장 사유 목록
export const SEND_OFF_CATEGORIES = vocabulary([
  "DOGSO",
  "SERIOUS_FOUL_PLAY",
  "BITING_OR_SPITTING",
  "VIOLENT_CONDUCT",
  "OFFENSIVE_LANGUAGE_OR_ACTION",
  "SECOND_CAUTION",
  "ENTERING_VOR",
  // 퇴장 사안 아님
  "NONE",
]);
export type SendOffCategory = (typeof SEND_OFF_CATEGORIES)[number];

// 절차 게이트 입력
// 판정 성격 목록
export const DECISION_NATURES = vocabulary(["SUBJECTIVE", "FACTUAL"]);
export type DecisionNature = (typeof DECISION_NATURES)[number];

// 문턱 게이트 입력
// 오류 크기 목록
export const ERROR_MAGNITUDES = vocabulary([
  "CLEAR_AND_OBVIOUS",
  "NOT_CLEAR_AND_OBVIOUS",
  "UNDETERMINED",
]);
export type ErrorMagnitude = (typeof ERROR_MAGNITUDES)[number];

// 판정 입력 부족 오류
// 평가 오류 목록
export const EVALUATION_ERROR_CODES = vocabulary([
  "UNKNOWN_RULE_VERSION",
  "UNKNOWN_COMPETITION_OPTION",
]);
export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[number];
