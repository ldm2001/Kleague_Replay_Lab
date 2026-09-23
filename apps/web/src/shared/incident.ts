// 공통 상태 값 목록 가져오기
import type { DisciplinaryAction, GoalDecision, RestartType } from "./vocabulary";

/** 생산자의 관측 주장만 표현하며 신뢰도와 구조 검증만으로 규정 사실 승인 불가 */
export interface IncidentAssertion {
    // 고유 식별자
    id: string;
    // 생산자의 관측 주장 상태이며 서버 승인은 별도
    state: "CONFIRMED" | "REFUTED" | "UNKNOWN" | "NOT_APPLICABLE";
    // 직접 측정과 추정 및 연결의 출처 구분
    origin: "IMAGE_MEASUREMENT" | "MODEL_ESTIMATE" | "EVENT_LINK";
    // 관측 또는 검사 방법
    method: { id: string; version: string };
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 관측 신뢰도이며 사실 승인 여부와 구분
    confidence: number | null;
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}
/** 추정 경기 시계가 아닌 원본 표시 시각 */
export interface IncidentSegment {
    // 구간 식별자와 샷·카메라 정보 및 시작·종료 시각
    id: string; shotId: string; cameraId: string | null; startMs: number; endMs: number;
    // 해당 영상 구간의 재생 속도
    playbackSpeed: "NORMAL" | "SLOW" | "UNKNOWN";
    // 본방과 리플레이의 구분 상태
    replayState: "LIVE" | "REPLAY" | "UNKNOWN";
    // 확인된 경기 시계의 밀리초 값
    matchClockMs: number | null;
}
// 원본 영상 근거의 자료 구조 정의
export interface IncidentEvidence {
    // 고유 식별자
    id: string;
    // 관측 영상 구간 식별자
    segmentId: string;
    // 결과 종류
    kind: "FRAME" | "CLIP";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 파일 내용의 해시
    contentSha256: string;
}
// 인물과 구간별 추적 연결의 자료 구조 정의
export interface IncidentActor {
    // 고유 식별자
    id: string;
    // 인물을 구간별 추적 조각으로 연결한 목록
    tracklets: readonly { segmentId: string; continuityId: string; trackId: string }[];
    /** 배정된 신원만 저장하며 확인된 관측 주장에만 값 허용 */
    teamId: string | null; teamAssignment: IncidentAssertion;
}
// 사건과 영상 구간의 연결의 자료 구조 정의
export interface IncidentLink {
    // 연결 식별자와 두 원본 구간 식별자
    id: string; firstSegmentId: string; secondSegmentId: string;
    // 두 구간이나 관측 사이의 관계
    relation: "SAME_INCIDENT" | "BEFORE" | "AFTER" | "SIMULTANEOUS";
    // 두 구간의 사건 연결에 관한 관측 주장
    assessment: IncidentAssertion;
}
// 검증할 경기 정보의 자료 구조 정의
export interface IncidentMatch {
    // 검증 대상 경기 식별자
    matchId: string | null;
    // 경기가 속한 대회
    competition: string | null;
    // 대회 시즌
    season: string | null;
    // 경기 날짜
    matchDate: string | null;
    // 국제 경기 규칙 판본 식별자
    ifabVersionId: string | null;
    // 경기 정보의 검증 상태
    verification: "VERIFIED" | "UNVERIFIED";
}
/** 반칙 성립이나 규정 우선순위와 구분된 관찰 행위의 반응·순서 정보 */
export const INCIDENT_CONTEXT_KEYS = Object.freeze([
    "actorIsPlayer",
    "targetIsPlayer",
    "opponents",
    "ballInPlay",
    "onField",
    "insideOwnPenaltyArea",
    "stoppedForThisAction",
    "advantageApplied",
    "otherActionInRestartSequence"
] as const);
// 행위 유형별 관측 항목 목록 정의
export const INCIDENT_OBSERVATION_KEYS = {
    // 해당 관찰 유형에 필요한 특징 목록 지정
    PUSHING_MOTION: [
        "actionObserved",
        "bodyContact",
        "extensionTowardOpponent",
        "opponentMotionChanged"
    ],
    // 해당 관찰 유형에 필요한 특징 목록 지정
    TACKLE_MOTION: [
        "actionObserved",
        "opponentContact",
        "ballContact",
        "ballContactBeforeOpponent",
        "legExtended",
        "footRaised",
        "challengingForBall"
    ],
    // 해당 관찰 유형에 필요한 특징 목록 지정
    HOLDING_MOTION: [
        "actionObserved",
        "bodyOrEquipmentContact",
        "gripMaintained",
        "pulling",
        "movementImpeded"
    ],
    // 해당 관찰 유형에 필요한 특징 목록 지정
    CHARGING_MOTION: [
        "actionObserved",
        "bodyContact",
        "shoulderContact",
        "approachFromSide",
        "challengingForBall"
    ],
    // 해당 관찰 유형에 필요한 특징 목록 지정
    HAND_ARM_BALL_CONTACT: [
        "actionObserved",
        "ballHandArmContact",
        "armMovesTowardBall",
        "armPositionObserved",
        "bodyMotionObserved",
        "directGoalByActor",
        "immediateGoalByActor"
    ]
} as const;
// 지원하는 관찰 행위 유형의 자료 구조 정의
export type IncidentActionType = keyof typeof INCIDENT_OBSERVATION_KEYS;
// 행위에 연결된 경기 문맥의 자료 구조 정의
export type IncidentContext = { [K in typeof INCIDENT_CONTEXT_KEYS[number]]: IncidentAssertion };
// 화면 좌표 기반 측정의 자료 구조 정의
export interface IncidentMeasurement extends Omit<IncidentAssertion, "state"> {
    // 측정한 물리량의 종류
    quantity: "IMAGE_DISTANCE" | "IMAGE_SPEED" | "ANGLE" | "DURATION";
    // 값
    value: number | null; unit: "px" | "px_per_s" | "deg" | "ms"; state: "KNOWN" | "UNKNOWN";
}
// 유형별 행위 관측의 자료 구조 정의
export type IncidentAction = { [T in IncidentActionType]: {
    // 고유 식별자
    id: string; type: T; actorId: string; targetActorId: string | null;
    // 관측 영상 구간 식별자
    segmentId: string; startMs: number; endMs: number;
    // 해당 행위에 연결된 경기 문맥
    context: IncidentContext;
    // 개별 관측 주장 묶음
    observations: { [K in typeof INCIDENT_OBSERVATION_KEYS[T][number]]: IncidentAssertion };
    // 화면 좌표에서 계산한 측정값
    measurements: readonly IncidentMeasurement[];
} }[IncidentActionType];
// 실제 주심 판정의 시점별 관측의 자료 구조 정의
export interface RefereeDecisionObservation {
    // 고유 식별자
    id: string;
    // 원심 변경 전후의 판정 단계
    phase: "INITIAL" | "REVISED" | "FINAL" | "UNKNOWN";
    // 관측 영상 구간 식별자
    segmentId: string;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    /** 대응 관측이 확인된 경우에만 값 저장 */
    restartType: RestartType | null;
    // 재개를 부여받는 팀 식별자
    restartBeneficiaryTeamId: string | null;
    // 관측된 카드 종류
    card: DisciplinaryAction | null;
    // 득점 인정 여부에 대한 관측
    goalDecision: GoalDecision | null;
    // 개별 관측 주장 묶음
    observations: {
        // 경기 재개에 관한 결과
        restart: IncidentAssertion;
        // 재개 수혜 쪽
        beneficiary: IncidentAssertion;
        // 관측된 카드 종류
        card: IncidentAssertion;
        // 득점 관련 관측
        goal: IncidentAssertion;
    };
}
// 관측과 경기 문맥을 담는 사건 계약의 자료 구조 정의
export interface IncidentRecordV1 {
    // 전송 자료의 구조 버전
    schemaVersion: "incident-record-v1";
    // 경합 사건 식별자
    incidentId: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 사건에 연결된 경기 정보
    match: IncidentMatch;
    // 관측 근거가 속한 원본 영상 구간 목록
    segments: readonly IncidentSegment[];
    // 관련 영상 근거 목록
    evidence: readonly IncidentEvidence[];
    // 사건에 등장한 인물과 구간별 추적 연결 목록
    actors: readonly IncidentActor[];
    // 구간 또는 사건 사이의 연결 근거
    links: readonly IncidentLink[];
    // 한 사건에서 관찰한 여러 행위
    actions: readonly IncidentAction[];
    // 시점별 실제 주심 판정 관측
    refereeDecisions: readonly RefereeDecisionObservation[];
}
