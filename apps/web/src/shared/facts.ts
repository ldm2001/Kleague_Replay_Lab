import type {
  CameraSufficiency,
  DecisionNature,
  DisplacementLevel,
  ErrorMagnitude,
  ObservationSpeed,
  ObservedSeverity,
  GoalDecision,
  RestartBeneficiary,
  ObservedSource,
  RestartType,
  DisciplinaryAction,
  SendOffCategory,
  ReviewScenario,
} from "./vocabulary";

// 사실값과 관측 조건
export type Observed<T> = {
  value: T;
  observedAtSpeed: ObservationSpeed;
  shotIds: string[];
};

// 관측 사실 객체 생성
export const observation = <T>(
  value: T,
  observedAtSpeed: ObservationSpeed,
  shotIds: string[] = [],
): Observed<T> => ({ value, observedAtSpeed, shotIds });

// 해당 밀기 사건의 적용 맥락. 생략된 과거 입력은 미확인으로 취급한다.
export type PushContext = {
  ballInPlay: Observed<boolean | null>;
  onField: Observed<boolean | null>;
  againstOpponent: Observed<boolean | null>;
  offenderRole: Observed<"ATTACKING_TEAM" | "DEFENDING_TEAM" | "UNKNOWN">;
  insideOwnPenaltyArea: Observed<boolean | null>;
  // NONE은 추가 징계 조건(DOGSO·SPA·기존 경고·어드밴티지·별도 비행)이 없음을 확인한 값이다.
  // 이를 확인하지 못했다면 UNKNOWN이며 NONE을 기본값으로 채우지 않는다.
  disciplinaryContext: Observed<"NONE" | "DOGSO" | "SPA" | "UNKNOWN">;
};

// 밀기 사실 묶음
export type PushFacts = {
  contactDetected: Observed<boolean | null>;
  severity: Observed<ObservedSeverity>;
  opponentDisplacement: Observed<DisplacementLevel>;
  insidePenaltyArea: Observed<boolean | null>;
  cameraSufficiency: CameraSufficiency;
  context?: PushContext;
};

// VAR 사실 묶음
export type VarFacts = {
  // 중계에서 관측한 판정 상황
  reviewScenario: ReviewScenario;
  // 검토 창을 닫는 조건
  restartOccurred: boolean | null;
  // 퇴장 사안과 재개 후 예외 입력
  sendOffCategory: SendOffCategory;
  // 다른 선수에게 카드가 수여된 상황
  mistakenIdentity: boolean | null;
  decisionNature: DecisionNature;
  errorMagnitude: ErrorMagnitude;
  // 주심단이 사건을 보지 못한 상황
  seriousMissedIncident: boolean | null;
};

// 관측 판정 묶음
export type ObservedDecision = {
  restartType: RestartType;
  restartBeneficiary: RestartBeneficiary;
  card: DisciplinaryAction | null;
  goalDecision: GoalDecision;
  source: ObservedSource;
};

// 전체 평가 사실 묶음
export type EvaluationFacts = {
  push: PushFacts;
  variable: VarFacts;
  observed: ObservedDecision;
};

// 대회 채택 옵션과 판본 분리
// 대회별 규정 옵션
export type CompetitionOptions = Readonly<Record<string, boolean | undefined>>;
