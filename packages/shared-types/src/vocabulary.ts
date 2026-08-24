/**
 * 판본과 무관한 어휘의 단일 소유자.
 *
 * 여기 있는 것: 값의 종류 (어떤 판정값이 존재하는가)
 * 여기 없는 것: 어느 판본에서 무엇이 열려 있는가 → packages/rule-data가 소유
 *
 * 이 구분을 지키지 않으면 판본이 바뀔 때 타입을 고치게 되고,
 * 규정 개정이 코드 배포와 묶인다 (README 11절).
 */

const vocabulary = <const T extends readonly string[]>(values: T): Readonly<T> =>
  Object.freeze(values);

export const AUTHORITIES = vocabulary(["IFAB", "KFA", "KLEAGUE"]);
export type Authority = (typeof AUTHORITIES)[number];

export const DECISIONS = vocabulary([
  "FOUL",
  "NO_FOUL",
  "NORMAL_CONTACT",
  "INCONCLUSIVE", // 영상 근거 부족 — 더 나은 영상이 있으면 답이 나온다
  "OUT_OF_SCOPE", // 규정에 조문 없음 — 영상을 아무리 봐도 답이 없다
]);
export type Decision = (typeof DECISIONS)[number];

export const SEVERITIES = vocabulary(["CARELESS", "RECKLESS", "EXCESSIVE_FORCE"]);
export type Severity = (typeof SEVERITIES)[number];

/**
 * 사실값으로 들어오는 강도. "uncertain"은 정도가 아니라 관측 결과의 부재이므로
 * SEVERITIES(규정이 구분하는 세 단계)와 섞지 않는다.
 */
export const OBSERVED_SEVERITIES = vocabulary([...SEVERITIES, "uncertain"]);
export type ObservedSeverity = (typeof OBSERVED_SEVERITIES)[number];

/** "none"은 밀림이 없었다는 관측이고 "uncertain"은 관측하지 못했다는 뜻이다. */
export const DISPLACEMENT_LEVELS = vocabulary(["none", "possible", "clear", "uncertain"]);
export type DisplacementLevel = (typeof DISPLACEMENT_LEVELS)[number];

export const OBSERVATION_SPEEDS = vocabulary(["NORMAL", "SLOW", "UNKNOWN"]);
export type ObservationSpeed = (typeof OBSERVATION_SPEEDS)[number];

export const RELEVANCES = vocabulary(["PRIMARY", "SUPPORTING", "COUNTER_READING"]);
export type Relevance = (typeof RELEVANCES)[number];

export const FACT_STATUSES = vocabulary(["ESTABLISHED", "UNMET"]);
export type FactStatus = (typeof FACT_STATUSES)[number];

/** `null`은 "관측했으나 값을 특정하지 못함"이고, 여기 값들은 "관측 자체가 막힘"이다. */
export const FACT_BLOCKERS = vocabulary(["CAMERA", "SPEED", "NOT_IN_FOOTAGE"]);
export type FactBlocker = (typeof FACT_BLOCKERS)[number];

export const CAMERA_SUFFICIENCY_LEVELS = vocabulary(["LOW", "MEDIUM", "HIGH"]);
export type CameraSufficiency = (typeof CAMERA_SUFFICIENCY_LEVELS)[number];

/**
 * 관측 재개와 추천 재개가 같은 어휘를 쓴다 (README 8절 `observed_restart_type`).
 * 두 벌을 두면 `decision_match` 비교가 값 변환을 먼저 해야 하고,
 * 변환표가 곧 두 어휘가 어긋날 수 있는 자리가 된다.
 *
 * 엔진은 이 중 일부만 낸다 — `UNKNOWN`은 관측 쪽 전용이고,
 * 엔진이 재개를 특정하지 못하면 `restart: null`에 INCONCLUSIVE를 붙인다.
 */
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
  "PLAY_CONTINUED", // 재개 없이 속행. "NONE"이 아니다 (README 8절 1250행)
  "UNKNOWN",
]);
export type RestartType = (typeof RESTART_TYPES)[number];

export const GOAL_DECISIONS = vocabulary(["GOAL", "NO_GOAL", "NOT_APPLICABLE", "UNKNOWN"]);
export type GoalDecision = (typeof GOAL_DECISIONS)[number];

/**
 * `observed_card`와 `disciplinary_action`이 함께 쓰는 어휘.
 *
 * 엔진은 `SECOND_CAUTION`을 내지 않는다 — 이 사건 하나만 보고는
 * 해당 선수가 이미 경고를 받았는지 알 수 없기 때문이다. 관측 쪽에서만 들어온다.
 */
export const DISCIPLINARY_ACTIONS = vocabulary([
  "NONE",
  "CAUTION",
  "SECOND_CAUTION",
  "SEND_OFF",
]);
export type DisciplinaryAction = (typeof DISCIPLINARY_ACTIONS)[number];

export const DECISION_MATCHES = vocabulary(["MATCH", "MISMATCH", "UNDETERMINED"]);
export type DecisionMatch = (typeof DECISION_MATCHES)[number];

export const CONFIDENCE_LEVELS = vocabulary(["LOW", "MEDIUM", "HIGH"]);
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const INCONCLUSIVE_REASONS = vocabulary([
  "CAMERA_INSUFFICIENT", // 각도 부족
  "SEVERITY_UNDETERMINED", // 강도 특정 불가
  "SLOW_MOTION_ONLY", // 정상 속도 관측 없음 (속도 게이트)
  "OUT_OF_SCOPE", // 경기규칙에 해당 조문 없음
]);
export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

export const VAR_CATEGORIES = vocabulary([
  "GOAL_NO_GOAL",
  "PENALTY_NO_PENALTY",
  "RED_CARD",
  "MISTAKEN_IDENTITY",
  "CORNER_KICK",
  "NONE",
]);
export type VarCategory = (typeof VAR_CATEGORIES)[number];

export const VAR_THRESHOLD_RESULTS = vocabulary(["MET", "NOT_MET", "UNDETERMINED"]);
export type VarThresholdResult = (typeof VAR_THRESHOLD_RESULTS)[number];

export const VAR_INTERVENTIONS = vocabulary(["NO_INTERVENTION", "OVERTURNED", "CONFIRMED"]);
export type VarIntervention = (typeof VAR_INTERVENTIONS)[number];

/** 어느 게이트가 막았는가. */
export const VAR_NO_INTERVENTION_REASONS = vocabulary([
  "NOT_REVIEWABLE",
  "TOO_LATE",
  "THRESHOLD_NOT_MET",
]);
export type VarNoInterventionReason = (typeof VAR_NO_INTERVENTION_REASONS)[number];

/** 범주 게이트가 왜 막았는가. "규정에 없다"와 "우리 대회는 안 쓴다"는 다른 문장이다. */
export const VAR_NOT_REVIEWABLE_REASONS = vocabulary([
  "OUTSIDE_REVIEWABLE_CATEGORIES",
  "COMPETITION_OPTION_NOT_ADOPTED",
]);
export type VarNotReviewableReason = (typeof VAR_NOT_REVIEWABLE_REASONS)[number];

/** 시한 게이트가 왜 막았는가. 검토 창을 닫는 유일한 조건은 재개다. */
export const VAR_WINDOW_CLOSED_REASONS = vocabulary(["PLAY_RESTARTED"]);
export type VarWindowClosedReason = (typeof VAR_WINDOW_CLOSED_REASONS)[number];

/**
 * 재개 뒤에도 검토 창이 열려 있는 사안.
 *
 * IFAB VAR 프로토콜 1.10 / Law 5.3 원문이 다섯을 든다 —
 * "mistaken identity or ... violent conduct, spitting, biting or
 *  extremely offensive, insulting and/or abusive action(s)".
 * README 8절 초안은 앞의 둘만 적었으나 그 어휘로는
 * "침 뱉기로 재개 후 퇴장"을 표현할 수 없다.
 */
export const VAR_WINDOW_EXCEPTIONS = vocabulary([
  "MISTAKEN_IDENTITY",
  "VIOLENT_CONDUCT",
  "BITING_OR_SPITTING",
  "OFFENSIVE_LANGUAGE_OR_ACTION",
  "NONE",
]);
export type VarWindowException = (typeof VAR_WINDOW_EXCEPTIONS)[number];

export const VAR_REVIEW_PROCEDURES = vocabulary(["OFR", "VAR_ONLY", "NONE"]);
export type VarReviewProcedure = (typeof VAR_REVIEW_PROCEDURES)[number];

/**
 * 중계에서 **관측한** 판정 상황. VAR 범주가 아니다 —
 * 어느 범주에 걸리는지는 판본 데이터의 매핑이 정한다 (README 8절 1039행).
 *
 * `OTHER`는 버리는 값이 아니다. 스로인·오프사이드 단독 장면처럼
 * 어느 범주에도 닿지 않는 입력이 여기로 들어오고, 엔진은 `OUT_OF_SCOPE`를 낸다.
 * 이 값을 빼면 "규정이 다루지 않는다"고 답할 경로가 사라진다.
 */
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

/**
 * IFAB Law 12.3 「Sending-off offences」 (2025/26 p.117) 아홉 항목을
 * 판정에 필요한 만큼 묶은 것.
 *
 * - DOGSO 세 항목(고의 핸드볼 · 자기 진영 밖 비고의 핸드볼 · 프리킥 반칙)은
 *   퇴장 사유로는 하나다. 셋의 구분은 재개 종류를 가를 뿐 창 예외에 영향이 없다.
 * - `BITING_OR_SPITTING`은 원문이 한 항목으로 적은 것을 그대로 둔 것이다.
 *   나눌 근거가 원문에 없다.
 */
export const SEND_OFF_CATEGORIES = vocabulary([
  "DOGSO",
  "SERIOUS_FOUL_PLAY",
  "BITING_OR_SPITTING",
  "VIOLENT_CONDUCT",
  "OFFENSIVE_LANGUAGE_OR_ACTION",
  "SECOND_CAUTION",
  "ENTERING_VOR",
  "NONE", // 퇴장 사안이 아님
]);
export type SendOffCategory = (typeof SEND_OFF_CATEGORIES)[number];

/** 절차 게이트의 입력. 문턱과 무관하며 절차만 가른다 (README 11절). */
export const DECISION_NATURES = vocabulary(["SUBJECTIVE", "FACTUAL"]);
export type DecisionNature = (typeof DECISION_NATURES)[number];

/**
 * 문턱 게이트의 입력 — 오심의 **정도**만 담는다 (README 8절 1048행).
 *
 * "심각한 미인지 사건"은 여기 값이 아니다. 원문이
 * "clear and obvious error **or** serious missed incident"로 둘을 나란히 놓으므로
 * 정도 축에 섞으면 "놓친 사건"이 "덜 명백한 오심"으로 읽힌다.
 * 미인지 여부는 `VarFacts.seriousMissedIncident` 불리언으로 따로 들어오고,
 * 문턱 게이트가 두 입력을 OR로 읽는다.
 */
export const ERROR_MAGNITUDES = vocabulary([
  "CLEAR_AND_OBVIOUS",
  "NOT_CLEAR_AND_OBVIOUS",
  "UNDETERMINED",
]);
export type ErrorMagnitude = (typeof ERROR_MAGNITUDES)[number];

/** 판정 결과가 아니라 입력이 부족하다는 신호. Decision과 섞지 않는다. */
export const EVALUATION_ERROR_CODES = vocabulary([
  "UNKNOWN_RULE_VERSION",
  "UNKNOWN_COMPETITION_OPTION",
]);
export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[number];
