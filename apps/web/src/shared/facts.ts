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

export const observation = <T>(
  value: T,
  observedAtSpeed: ObservationSpeed,
  shotIds: string[] = [],
): Observed<T> => ({ value, observedAtSpeed, shotIds });

export type PushFacts = {
  contactDetected: Observed<boolean>;
  severity: Observed<ObservedSeverity>;
  opponentDisplacement: Observed<DisplacementLevel>;
  insidePenaltyArea: Observed<boolean>;
  cameraSufficiency: CameraSufficiency;
};

export type VarFacts = {
  // 중계에서 관측한 판정 상황
  reviewScenario: ReviewScenario;
  // 검토 창을 닫는 조건
  restartOccurred: boolean;
  // 퇴장 사안과 재개 후 예외 입력
  sendOffCategory: SendOffCategory;
  // 다른 선수에게 카드가 수여된 상황
  mistakenIdentity: boolean;
  decisionNature: DecisionNature;
  errorMagnitude: ErrorMagnitude;
  // 주심단이 사건을 보지 못한 상황
  seriousMissedIncident: boolean;
};

export type ObservedDecision = {
  restartType: RestartType;
  restartBeneficiary: RestartBeneficiary;
  card: DisciplinaryAction | null;
  goalDecision: GoalDecision;
  source: ObservedSource;
};

export type EvaluationFacts = {
  push: PushFacts;
  variable: VarFacts;
  observed: ObservedDecision;
};

// 대회 채택 옵션과 판본 분리
export type CompetitionOptions = Readonly<Record<string, boolean | undefined>>;
