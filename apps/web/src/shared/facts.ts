// 공통 상태 값 목록 가져오기
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
    ReviewScenario
} from "./vocabulary";

// 사실값과 관측 조건
export type Observed<T> = {
    // 값
    value: T;
    // 관측에 사용한 재생 속도
    observedAtSpeed: ObservationSpeed;
    // 확인에 사용한 샷 식별자 목록
    shotIds: string[];
};

// 관측 사실 객체 생성
export const observation = <T>(
    value: T,
    observedAtSpeed: ObservationSpeed,
    shotIds: string[] = [],
): Observed<T> => ({ value, observedAtSpeed, shotIds });

// 밀기 사건의 적용 맥락이며 생략된 과거 입력은 미확인으로 취급
export type PushContext = {
    // 공이 인플레이 상태인지 여부
    ballInPlay: Observed<boolean | null>;
    // 행위가 경기장 안에서 발생했는지 여부
    onField: Observed<boolean | null>;
    // 대상이 실제 상대 팀 선수인지 여부
    againstOpponent: Observed<boolean | null>;
    // 행위자의 공격·수비 역할
    offenderRole: Observed<"ATTACKING_TEAM" | "DEFENDING_TEAM" | "UNKNOWN">;
    // 행위가 자기 팀 페널티 지역에 있는지 여부
    insideOwnPenaltyArea: Observed<boolean | null>;
    // 없음 상태은 추가 징계 조건(명백한 득점 기회 저지·유망한 공격 저지·기존 경고·어드밴티지·별도 비행)이 없음을 확인한 값
    // 추가 징계 조건을 확인하지 못하면 미확인 유지하며 없음 상태의 기본 입력 제외
    disciplinaryContext: Observed<"NONE" | "DOGSO" | "SPA" | "UNKNOWN">;
};

// 밀기 사실 묶음
export type PushFacts = {
    // 실제 접촉의 관측값
    contactDetected: Observed<boolean | null>;
    // 행위 강도 평가
    severity: Observed<ObservedSeverity>;
    // 상대 움직임 변화의 관측 수준
    opponentDisplacement: Observed<DisplacementLevel>;
    // 행위 위치의 페널티 지역 여부
    insidePenaltyArea: Observed<boolean | null>;
    // 질문 확인에 필요한 카메라 근거 충분성
    cameraSufficiency: CameraSufficiency;
    // 해당 행위에 연결된 경기 문맥
    context?: PushContext;
};

// 비디오 판독 사실 묶음
export type VarFacts = {
    // 중계에서 관측한 판정 상황
    reviewScenario: ReviewScenario;
    // 검토 창을 닫는 조건
    restartOccurred: boolean | null;
    // 퇴장 사안과 재개 후 예외 입력
    sendOffCategory: SendOffCategory;
    // 다른 선수에게 카드가 수여된 상황
    mistakenIdentity: boolean | null;
    // 사실 판정과 주관 평가의 구분
    decisionNature: DecisionNature;
    // 원심 오류의 명확성 수준
    errorMagnitude: ErrorMagnitude;
    // 주심단이 사건을 보지 못한 상황
    seriousMissedIncident: boolean | null;
};

// 관측 판정 묶음
export type ObservedDecision = {
    // 경기 재개 방식
    restartType: RestartType;
    // 재개를 부여받는 쪽
    restartBeneficiary: RestartBeneficiary;
    // 관측된 카드 종류
    card: DisciplinaryAction | null;
    // 득점 인정 여부에 대한 관측
    goalDecision: GoalDecision;
    // 원본 정보
    source: ObservedSource;
};

// 전체 평가 사실 묶음
export type EvaluationFacts = {
    // 밀기 관련 관측 사실
    push: PushFacts;
    // 비디오 판독 조건 사실
    variable: VarFacts;
    // 영상에서 직접 확인한 판정 정보
    observed: ObservedDecision;
};

// 대회 채택 옵션과 판본 분리
// 대회별 규정 옵션
export type CompetitionOptions = Readonly<Record<string, boolean | undefined>>;
