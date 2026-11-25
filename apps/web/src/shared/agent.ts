// 사건 관측 키 목록 가져오기
import { INCIDENT_CONTEXT_KEYS, INCIDENT_OBSERVATION_KEYS } from "./incident";
// 사건 기록과 같은 문자열과 날짜 규칙 가져오기
import { calendarDate, text } from "./incident-schema";

// 검사 전 임의 객체의 자료 구조 정의
type Data = Record<string, unknown>;

// 판례 사실 출처 종류 목록 정의
const SOURCES = ["OFFICIAL_RELEASE", "MATCH_RECORD", "HUMAN_LABEL"] as const;

// 기술별 문턱 키 목록 정의
const RULES = {
    // 근접과 원거리 거리 비율과 최소 연속 시간과 측정 비율
    action: ["nearBelow", "farAbove", "minMs", "minCoverage"],
    // 접촉 확인과 부정 거리 비율과 확인 시간과 측정 비율
    contact: ["confirmBelow", "confirmMinMs", "refuteAbove", "minCoverage"],
    // 행위자 쪽 우세 비율과 측정 비율
    direction: ["majority", "minCoverage"],
    // 잡기 확인 시간 하한과 부정 시간 상한
    grip: ["confirmMinMs", "refuteMaxMs"],
    // 팔꿈치 각도 감소량의 확인과 부정 문턱과 최소 관측 시간과 측정 비율
    pulling: ["confirmDeltaDeg", "refuteDeltaDeg", "minMs", "minCoverage"],
    // 속도 감소율의 확인과 부정 문턱과 최소 기준 속도와 측정 비율
    impeded: ["confirmDrop", "refuteDrop", "minBaseline", "minCoverage"]
} as const;

// 잡기 관측 사실별 판단 기술 대응 정의
const SKILLS = {
    actionObserved: "action",
    bodyOrEquipmentContact: "contact",
    directionObserved: "direction",
    gripMaintained: "grip",
    pulling: "pulling",
    movementImpeded: "impeded"
} as const satisfies Record<AgentFact, AgentSkill>;

// 잡기 관측 사실 키 목록 정의
const HOLDING = INCIDENT_OBSERVATION_KEYS.HOLDING_MOTION;

// 양의 정수 시간 문턱 키 목록 정의
const TIMES = ["minMs", "confirmMinMs", "refuteMaxMs"];

// 경기 정보 필드 목록 정의
const MATCH_KEYS = ["matchId", "competition", "season", "matchDate"];

// 판례 입력 최상위 필드 목록 정의
const CASE_KEYS = [
    "schemaVersion",
    "caseId",
    "sourceSha256",
    "artifactSha256",
    "match",
    "eventId",
    "actorId",
    "targetId",
    "tracks",
    "startMs",
    "endMs",
    "actionType",
    "teams",
    "facts"
];

// 보정 최상위 필드 목록 정의
const CALIBRATION_KEYS = ["schemaVersion", "method", "status", "reportSha256", "facts"];

// 잡기 동작 관측 사실 이름의 자료 구조 정의
export type AgentFact = (typeof HOLDING)[number];

// 판례 사실 출처 종류의 자료 구조 정의
export type AgentSourceKind = (typeof SOURCES)[number];

// 판례 사실 출처의 자료 구조 정의
export type AgentSource = Readonly<{
    // 출처 종류
    kind: AgentSourceKind;
    // 출처 안의 참조 위치
    reference: string;
}>;

// 판례 맥락 사실 상태와 출처의 자료 구조 정의
export type AgentCaseFact =
    | Readonly<{ state: "CONFIRMED" | "REFUTED"; source: AgentSource }>
    | Readonly<{ state: "UNKNOWN"; source: null }>;

// 판례 팀 소속 상태와 출처의 자료 구조 정의
export type AgentCaseTeam =
    | Readonly<{ teamId: string; state: "CONFIRMED"; source: AgentSource }>
    | Readonly<{ teamId: null; state: "UNKNOWN"; source: null }>;

// 판례 인물 트랙 참조의 자료 구조 정의
export type AgentTrack = Readonly<{
    // 트랙이 속한 영상 구간 식별자
    segmentId: string;
    // 구간 안의 트랙 식별자
    trackId: string;
}>;

// 규정 에이전트 판례 입력의 자료 구조 정의
export type AgentCaseInput = Readonly<{
    // 확인할 버전
    schemaVersion: "agent-case-input-v1";
    // 판례 식별자
    caseId: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 관측 산출물의 내용 해시
    artifactSha256: string;
    // 검증된 경기 기록 생성용 경기 정보
    match: Readonly<{
        // 경기 식별자
        matchId: string;
        // 대회 구분
        competition: string;
        // 시즌 구분
        season: string;
        // 달력 날짜 형식의 경기 날짜
        matchDate: string;
    }>;
    // 라벨 사건 식별자
    eventId: string;
    // 라벨 행위자 식별자
    actorId: string;
    // 라벨 대상 식별자
    targetId: string;
    // 행위자와 대상의 트랙 참조
    tracks: Readonly<{
        // 행위자 트랙
        actor: AgentTrack;
        // 대상 트랙
        target: AgentTrack;
    }>;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 판례 행위 유형
    actionType: "HOLDING_MOTION";
    // 행위자와 대상의 팀 소속
    teams: Readonly<{
        // 행위자 팀 소속
        actor: AgentCaseTeam;
        // 대상 팀 소속
        target: AgentCaseTeam;
    }>;
    // 맥락 사실 아홉 종의 상태와 출처
    facts: Readonly<Record<(typeof INCIDENT_CONTEXT_KEYS)[number], AgentCaseFact>>;
}>;

// 판단 기술 이름의 자료 구조 정의
export type AgentSkill = keyof typeof RULES;

// 기술별 문턱 규칙의 자료 구조 정의
export type AgentRules = {
    readonly [S in AgentSkill]: Readonly<Record<(typeof RULES)[S][number], number>>;
};

// 사실별 판단 기술과 실행 순서와 문턱의 자료 구조 정의
export type AgentFactRule<S extends AgentSkill> = Readonly<{
    // 사실을 판단하는 기술
    skill: S;
    // 실행 순서
    priority: number;
    // 먼저 판단할 사실 목록
    requires: readonly AgentFact[];
    // 기술별 문턱
    rule: AgentRules[S];
}>;

// 규정 에이전트 보정의 자료 구조 정의
export type AgentCalibration = Readonly<{
    // 확인할 버전
    schemaVersion: "agent-calibration-v1";
    // 에이전트 방법과 판 번호
    method: Readonly<{
        // 방법 식별자
        id: "brain-agent";
        // 앞자리 0 없는 양의 정수 판 번호
        version: string;
    }>;
    // 보정 상태
    status: "UNCALIBRATED" | "CALIBRATED_DEVELOPMENT";
    // 개발 분할 검증 보고서 해시
    reportSha256: string | null;
    // 잡기 관측 사실별 규칙
    facts: Readonly<{ [K in AgentFact]: AgentFactRule<(typeof SKILLS)[K]> }>;
}>;

// 객체 형식 확인
const object = (v: unknown): v is Data =>
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// 필수 필드 확인
const keys = (v: unknown, expected: readonly string[]): v is Data =>
    object(v) &&
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k));

// 허용 목록에 포함된 값 확인
const oneOf = (v: unknown, values: readonly string[]) =>
    typeof v === "string" && values.includes(v);

// 시각 범위 확인
const time = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// 해시 형식 확인
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// 출처 종류와 참조 확인
const source = (v: unknown) =>
    keys(v, ["kind", "reference"]) &&
    oneOf(v.kind, SOURCES) &&
    typeof v.reference === "string" &&
    v.reference.trim().length > 0;

// 맥락 사실 상태와 출처 확인
const fact = (v: unknown) =>
    keys(v, ["state", "source"]) &&
    ((v.state === "UNKNOWN" && v.source === null) ||
        (oneOf(v.state, ["CONFIRMED", "REFUTED"]) && source(v.source)));

// 팀 소속 상태와 식별자와 출처 확인
const team = (v: unknown) =>
    keys(v, ["teamId", "state", "source"]) &&
    ((v.state === "UNKNOWN" && v.teamId === null && v.source === null) ||
        (v.state === "CONFIRMED" && text(v.teamId) && source(v.source)));

// 트랙 참조의 구간과 트랙 식별자 확인
const track = (v: unknown): v is Data =>
    keys(v, ["segmentId", "trackId"]) && text(v.segmentId) && text(v.trackId);

// 행위자와 대상 트랙의 같은 구간과 다른 트랙 확인
const tracks = (v: unknown) =>
    keys(v, ["actor", "target"]) &&
    track(v.actor) &&
    track(v.target) &&
    v.actor.segmentId === v.target.segmentId &&
    v.actor.trackId !== v.target.trackId;

// 경기 정보 네 필드의 문자열과 날짜 확인
const match = (v: unknown) =>
    keys(v, MATCH_KEYS) && MATCH_KEYS.every((k) => text(v[k])) && calendarDate(v.matchDate);

// 맥락 사실 아홉 종의 상태와 출처 확인
const context = (v: unknown) =>
    keys(v, INCIDENT_CONTEXT_KEYS) && INCIDENT_CONTEXT_KEYS.every((k) => fact(v[k]));

// 문턱 키별 값 범위 확인
const threshold = (key: string, v: unknown) => {
    // 유한한 수가 아닌 값 거절
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
    // 시간 문턱의 양의 정수 여부 반환
    if (TIMES.includes(key)) return Number.isSafeInteger(v) && v > 0;
    // 측정 비율의 0 초과 1 이하 여부 반환
    if (key === "minCoverage") return v > 0 && v <= 1;
    // 우세 비율의 절반 초과 1 이하 여부 반환
    if (key === "majority") return v > 0.5 && v <= 1;
    // 그 밖 문턱의 양수 여부 반환
    return v > 0;
};

// 기술별 문턱 키와 값 범위 확인
const rule = (skill: AgentSkill, v: unknown) => {
    // 기술의 문턱 키 목록 참조
    const names: readonly string[] = RULES[skill];
    // 문턱 키 일치와 값 범위 충족 여부 반환
    return keys(v, names) && names.every((k) => threshold(k, v[k]));
};

// 먼저 판단할 사실 목록의 중복 없음과 잡기 관측 키 범위 확인
const needs = (v: unknown) =>
    Array.isArray(v) && new Set(v).size === v.length && v.every((k) => oneOf(k, HOLDING));

// 사실 항목의 기술과 실행 순서와 문턱 확인
const entry = (name: AgentFact, v: unknown) =>
    keys(v, ["skill", "priority", "requires", "rule"]) &&
    v.skill === SKILLS[name] &&
    typeof v.priority === "number" &&
    Number.isSafeInteger(v.priority) &&
    v.priority > 0 &&
    needs(v.requires) &&
    rule(SKILLS[name], v.rule);

// 방법 식별자와 판 번호 확인
const method = (v: unknown) =>
    keys(v, ["id", "version"]) &&
    v.id === "brain-agent" &&
    typeof v.version === "string" &&
    /^[1-9][0-9]*$/.test(v.version);

// 보정 상태와 보고서 해시 조합 확인
const status = (s: unknown, hash: unknown) =>
    (s === "UNCALIBRATED" && hash === null) || (s === "CALIBRATED_DEVELOPMENT" && sha(hash));

// 사실별 실행 순서의 중복 없음 확인
const priorities = (f: AgentCalibration["facts"]) =>
    new Set(HOLDING.map((k) => f[k].priority)).size === HOLDING.length;

// 먼저 판단할 사실의 더 낮은 실행 순서 확인
const precedes = (f: AgentCalibration["facts"]) =>
    HOLDING.every((name) => f[name].requires.every((k) => f[k].priority < f[name].priority));

// 기술 사이 문턱 순서 확인
const order = (f: AgentCalibration["facts"]) => {
    // 동작 문턱 참조
    const action = f.actionObserved.rule;
    // 접촉 문턱 참조
    const contact = f.bodyOrEquipmentContact.rule;
    // 잡기 유지 문턱 참조
    const grip = f.gripMaintained.rule;
    // 당기기 문턱 참조
    const pulling = f.pulling.rule;
    // 이동 방해 문턱 참조
    const impeded = f.movementImpeded.rule;
    // 거리와 각도와 감소율과 시간 문턱의 순서 충족 여부 반환
    return (
        contact.confirmBelow < contact.refuteAbove &&
        contact.refuteAbove < action.nearBelow &&
        action.nearBelow < action.farAbove &&
        pulling.refuteDeltaDeg < pulling.confirmDeltaDeg &&
        impeded.refuteDrop < impeded.confirmDrop &&
        contact.confirmMinMs <= grip.refuteMaxMs &&
        grip.refuteMaxMs < grip.confirmMinMs
    );
};

// 규정 에이전트 판례 입력 형식 확인
export function agentCaseData(v: unknown): v is AgentCaseInput {
    // 최상위 필드 목록 확인
    if (!keys(v, CASE_KEYS)) return false;
    // 버전과 식별자와 해시와 경기와 트랙과 시간과 팀과 맥락 사실 충족 여부 반환
    return (
        v.schemaVersion === "agent-case-input-v1" &&
        text(v.caseId) &&
        sha(v.sourceSha256) &&
        sha(v.artifactSha256) &&
        match(v.match) &&
        text(v.eventId) &&
        text(v.actorId) &&
        text(v.targetId) &&
        v.actorId !== v.targetId &&
        tracks(v.tracks) &&
        time(v.startMs) &&
        time(v.endMs) &&
        v.endMs > v.startMs &&
        v.actionType === "HOLDING_MOTION" &&
        keys(v.teams, ["actor", "target"]) &&
        team(v.teams.actor) &&
        team(v.teams.target) &&
        context(v.facts)
    );
}

// 규정 에이전트 보정 형식과 순서 확인
export function calibrationData(v: unknown): v is AgentCalibration {
    // 최상위 필드와 버전과 방법과 상태 조합 확인
    if (
        !keys(v, CALIBRATION_KEYS) ||
        v.schemaVersion !== "agent-calibration-v1" ||
        !method(v.method) ||
        !status(v.status, v.reportSha256)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 사실별 규칙 묶음 참조
    const facts = v.facts;
    // 사실 키와 항목 형식 확인
    if (!keys(facts, HOLDING) || !HOLDING.every((k) => entry(k, facts[k]))) return false;
    // 형식이 확인된 사실별 규칙 참조
    const f = facts as AgentCalibration["facts"];
    // 실행 순서와 문턱 순서 충족 여부 반환
    return priorities(f) && precedes(f) && order(f);
}
