// 엔진이 쓸 수 있는 낱말의 닫힌 집합
// 판본과 무관한 값만 둠 — 그 판본에서 무엇이 열려 있는지는 rule-data가 소유함
// CORNER_KICK이 여기 있는데 2025-26 활성 집합에 없는 것이 그 차이를 보여주는 자리임

// 배열 상수를 먼저 두고 타입을 파생시킴
// 유니온만 쓰면 값 목록이 런타임에 없어서 검사기가 SSOT를 확인하지 못함

// ── 사건과 사실 ──

// 무엇이 일어났는가 — VAR 범주 게이트의 입력이고 범주 자체가 아님
export const INCIDENT_TYPE = [
  "GOAL_DISALLOWED", "GOAL_AWARDED", "PENALTY_NOT_GIVEN", "PENALTY_GIVEN",
  "SENDING_OFF_NOT_GIVEN", "CARD_SHOWN", "SECOND_CAUTION", "CORNER_KICK_AWARDED",
  "OTHER",
] as const;

// 득점이 취소된 사유
export const DISALLOW_REASON = ["ATTACKING_TEAM_FOUL", "OFFSIDE", "BALL_OUT_OF_PLAY", "OTHER"] as const;

// 주심이 무엇을 판정했는가 — UNKNOWN이 아니라는 사실이 VAR 검토의 전제임
export const REFEREE_DECISION_TYPE = [
  "NO_FOUL", "FOUL_AGAINST_ATTACKER", "FOUL_AGAINST_DEFENDER", "PLAY_ON", "UNKNOWN",
] as const;

// 사실적 판정인가 주관적 판정인가 — 절차 게이트만 읽고 문턱과 무관함
export const DECISION_NATURE = ["FACTUAL", "SUBJECTIVE"] as const;

// 오류의 명백성 — VAR 문턱 게이트가 읽음
export const ERROR_MAGNITUDE = ["CLEAR_AND_OBVIOUS", "NOT_CLEAR_AND_OBVIOUS", "UNDETERMINED"] as const;

// 어느 속도로 관측했는가 — SLOW만 있으면 속도 게이트에 걸림
export const PLAYBACK_SPEED = ["NORMAL", "SLOW", "UNKNOWN"] as const;

// Law 12의 강도 등급 — 징계를 결정함
export const SEVERITY = ["CARELESS", "RECKLESS", "EXCESSIVE_FORCE"] as const;

// ── 엔진 산출 ──

// 밀기 판정의 결론
export const DECISION = ["FOUL", "NO_FOUL", "NORMAL_CONTACT", "INCONCLUSIVE", "OUT_OF_SCOPE"] as const;

// 결론을 못 낸 이유 — OUT_OF_SCOPE는 영상 부족이 아니라 규정에 조문이 없는 경우임
export const INCONCLUSIVE_REASON = [
  "CAMERA_INSUFFICIENT", "SEVERITY_UNDETERMINED", "SLOW_MOTION_ONLY", "OUT_OF_SCOPE",
] as const;

// 규정이 정하는 재개 방식
export const RESTART = ["DIRECT_FREE_KICK", "PENALTY_KICK", "DROP_BALL", "NONE"] as const;

// 강도에서 나오는 징계
export const DISCIPLINARY = ["NONE", "CAUTION", "SEND_OFF"] as const;

// 산출물의 확신도
export const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;

// 값을 모른다는 사실 자체를 값으로 들고 감 — 기본값으로 채우지 않음
export const EVALUATION_ERROR = ["UNKNOWN_RULE_VERSION", "UNKNOWN_COMPETITION_OPTION"] as const;

// ── 근거 ──

// 조항을 발행한 주체 — accounts[]가 계층마다 하나씩 실음
export const AUTHORITY = ["IFAB", "KFA", "KLEAGUE"] as const;

// 그 조항이 이 상황에 얼마나 직접 걸리는가
export const RELEVANCE = ["PRIMARY", "SUPPORTING", "COUNTER_READING"] as const;

// 조항이 요구하는 사실값이 확정됐는가
export const FACT_STATUS = ["ESTABLISHED", "UNMET"] as const;

// 사실값을 막은 것이 무엇인가 — 막혀도 accounts는 비지 않음
export const BLOCKED_BY = ["CAMERA", "SPEED", "NOT_IN_FOOTAGE"] as const;

// ── VAR 네 게이트 ──

// ① 범주 — 판본에 이 이름이 있어도 활성 집합에 없을 수 있음
export const VAR_CATEGORY = [
  "GOAL_NO_GOAL", "PENALTY_NO_PENALTY", "RED_CARD", "MISTAKEN_IDENTITY", "CORNER_KICK", "NONE",
] as const;

// 범주 게이트가 막은 이유 — 규정에 없는 것과 대회가 안 쓰는 것을 나눔
export const VAR_NOT_REVIEWABLE_REASON = [
  "OUTSIDE_REVIEWABLE_CATEGORIES", "COMPETITION_OPTION_NOT_ADOPTED",
] as const;

// ② 시한 — 창을 닫는 것은 주심의 선언이 아니라 재개임
export const VAR_WINDOW_CLOSED_REASON = ["PLAY_RESTARTED"] as const;

// 재개 후에도 창이 열려 있는 경우
export const VAR_WINDOW_EXCEPTION = ["MISTAKEN_IDENTITY", "VIOLENT_CONDUCT", "NONE"] as const;

// ③ 문턱 — 강도가 속도 게이트에 걸리면 UNDETERMINED가 정직한 값임
export const VAR_THRESHOLD_MET = ["MET", "NOT_MET", "UNDETERMINED"] as const;

// ④ 절차 — 사실적·주관적 구분에서 나오고 문턱과 무관함
export const VAR_REVIEW_PROCEDURE = ["OFR", "VAR_ONLY", "NONE"] as const;

// 네 게이트를 통과한 뒤의 결과
export const VAR_INTERVENTION = ["NO_INTERVENTION", "OVERTURNED", "CONFIRMED"] as const;

// 개입하지 않은 이유를 게이트별로 구분 — 결과가 같아도 의미가 달라서 합치지 않음
export const VAR_NO_INTERVENTION_REASON = ["NOT_REVIEWABLE", "TOO_LATE", "THRESHOLD_NOT_MET"] as const;

// ── 관측 ──

// 재개 방식에서 역산한 실제 판정 — FREE_KICK_UNSPECIFIED를 임의로 채우지 않음
export const OBSERVED_RESTART_TYPE = [
  "DIRECT_FREE_KICK", "INDIRECT_FREE_KICK", "FREE_KICK_UNSPECIFIED", "PENALTY_KICK",
  "DROP_BALL", "THROW_IN", "GOAL_KICK", "CORNER_KICK", "KICK_OFF", "PLAY_CONTINUED", "UNKNOWN",
] as const;

// 재개가 어느 팀에 주어졌는가
export const OBSERVED_RESTART_BENEFICIARY = ["ATTACKING_TEAM", "DEFENDING_TEAM", "NONE", "UNKNOWN"] as const;

// 득점이 인정됐는가
export const OBSERVED_GOAL_DECISION = ["GOAL", "NO_GOAL", "NOT_APPLICABLE", "UNKNOWN"] as const;

// 관측을 어디서 얻었는가 — 역산과 직접 관측을 구분함
export const OBSERVED_SOURCE = [
  "RESTART_INFERRED", "REFEREE_SIGNAL", "VAR_OFR", "USER_INPUT", "MATCH_REPORT",
] as const;

// 추천 판정과 관측 판정이 맞는가 — MISMATCH가 이 시스템의 산출물임
export const DECISION_MATCH = ["MATCH", "MISMATCH", "UNDETERMINED"] as const;

// ── 공식 발표 ──

// 발표 주체 — 발화자 개인은 기록하지 않음
export const ANNOUNCED_BY = ["KFA_REFEREE_COMMITTEE", "COMPETITION_ORGANISER", "OTHER"] as const;

// 발표된 평가
export const OFFICIAL_VERDICT = ["CORRECT", "INCORRECT", "NO_COMMENT"] as const;

// ── 파생 타입 ──

export type IncidentType = (typeof INCIDENT_TYPE)[number];
export type DisallowReason = (typeof DISALLOW_REASON)[number];
export type RefereeDecisionType = (typeof REFEREE_DECISION_TYPE)[number];
export type DecisionNature = (typeof DECISION_NATURE)[number];
export type ErrorMagnitude = (typeof ERROR_MAGNITUDE)[number];
export type PlaybackSpeed = (typeof PLAYBACK_SPEED)[number];
export type Severity = (typeof SEVERITY)[number];

export type Decision = (typeof DECISION)[number];
export type InconclusiveReason = (typeof INCONCLUSIVE_REASON)[number];
export type Restart = (typeof RESTART)[number];
export type Disciplinary = (typeof DISCIPLINARY)[number];
export type Confidence = (typeof CONFIDENCE)[number];
export type EvaluationError = (typeof EVALUATION_ERROR)[number];

export type Authority = (typeof AUTHORITY)[number];
export type Relevance = (typeof RELEVANCE)[number];
export type FactStatus = (typeof FACT_STATUS)[number];
export type BlockedBy = (typeof BLOCKED_BY)[number];

export type VarCategory = (typeof VAR_CATEGORY)[number];
export type VarNotReviewableReason = (typeof VAR_NOT_REVIEWABLE_REASON)[number];
export type VarWindowClosedReason = (typeof VAR_WINDOW_CLOSED_REASON)[number];
export type VarWindowException = (typeof VAR_WINDOW_EXCEPTION)[number];
export type VarThresholdMet = (typeof VAR_THRESHOLD_MET)[number];
export type VarReviewProcedure = (typeof VAR_REVIEW_PROCEDURE)[number];
export type VarIntervention = (typeof VAR_INTERVENTION)[number];
export type VarNoInterventionReason = (typeof VAR_NO_INTERVENTION_REASON)[number];

export type ObservedRestartType = (typeof OBSERVED_RESTART_TYPE)[number];
export type ObservedRestartBeneficiary = (typeof OBSERVED_RESTART_BENEFICIARY)[number];
export type ObservedGoalDecision = (typeof OBSERVED_GOAL_DECISION)[number];
export type ObservedSource = (typeof OBSERVED_SOURCE)[number];
export type DecisionMatch = (typeof DECISION_MATCH)[number];

export type AnnouncedBy = (typeof ANNOUNCED_BY)[number];
export type OfficialVerdict = (typeof OFFICIAL_VERDICT)[number];
