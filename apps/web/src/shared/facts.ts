import type {
  CameraSufficiency,
  DecisionNature,
  DisplacementLevel,
  ErrorMagnitude,
  ObservationSpeed,
  ObservedSeverity,
  SendOffCategory,
  ReviewScenario,
} from "./vocabulary";

/** 사실값은 값과 관측 조건을 함께 가진다 (README 2절). */
export type Observed<T> = {
  value: T;
  observedAtSpeed: ObservationSpeed;
  shotIds: string[];
};

export const observed = <T>(
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
  /** 중계에서 관측한 판정 상황. VAR 범주가 아니다 — 매핑은 판본 데이터가 갖는다. */
  reviewScenario: ReviewScenario;
  /** 검토 창을 닫는 유일한 조건. 주심이 판정을 내렸다는 사실은 차단 조건이 아니다. */
  restartOccurred: boolean;
  /** 퇴장 사안이 아니면 `"NONE"`. 재개 후 예외 판정(VAR 1.10)의 입력이다. */
  sendOffCategory: SendOffCategory;
  /**
   * 주심이 **다른 선수**에게 카드를 줬는가 (IFAB VAR 1.1.d).
   *
   * `reviewScenario`의 값이 아니라 별도 입력인 이유: 선수 확인 오류는 사건의
   * 종류가 아니라 카드 수여자의 속성이고, 경고와 퇴장 양쪽에서 일어난다.
   * 이 값이 MISTAKEN_IDENTITY 범주와 재개 후 예외 양쪽의 입구다.
   */
  mistakenIdentity: boolean;
  decisionNature: DecisionNature;
  errorMagnitude: ErrorMagnitude;
  /**
   * 주심단이 사건 자체를 보지 못했는가 (IFAB VAR 프로토콜 원문의
   * "a serious incident is missed/not seen by the match officials").
   *
   * `errorMagnitude`와 별개 입력이다. 원문이 문턱을 두 갈래의 OR로 적었고,
   * 정도 축에 섞으면 "놓친 사건"이 "덜 명백한 오심"으로 읽힌다.
   */
  seriousMissedIncident: boolean;
};

/**
 * 대회가 무엇을 채택했는가. 판본과는 별개 축이다.
 * 키가 없는 것(undefined)과 false는 다르다 — 모르는 것을 미채택으로 접지 않는다.
 */
export type CompetitionOptions = Readonly<Record<string, boolean | undefined>>;
