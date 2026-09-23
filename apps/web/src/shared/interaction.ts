// 사건 관측 자료형 가져오기
import {
    INCIDENT_OBSERVATION_KEYS,
    type IncidentActionType,
    type IncidentRecordV1
} from "./incident";
// 사건 구조 검증 기능 가져오기
import { incidentRecordData } from "./incident-schema";

// 미확인 상태와 사유의 자료 구조 정의
type Unknown = { state: "UNKNOWN"; value: null; reasons: readonly string[] };
// 유형과 방향의 독립 가설의 자료 구조 정의
export type InteractionHypothesis<T> = Unknown | {
    // 현재 확인 상태
    state: "HYPOTHESIS"; value: T; reasons: readonly string[];
    // 관측 또는 검사 방법
    method: { id: string; version: string }; observationIds: readonly string[];
};
// 신원 확정과 구분된 참여자 추적 정보의 자료 구조 정의
type Participant = {
    // 현재 연속 구간의 추적 식별자
    trackId: string;
    // 추적이 이어지는 구간 식별자
    continuityId: number;
    // 관측 영상 구간 식별자
    segmentId: string;
    // 실제 신원과 구분된 추적 상태
    identityState: "TRACK_FRAGMENT_ONLY";
};
// 영상 좌표 측정값의 자료 구조 정의
type Measurement = {
    // 현재 확인 상태
    state: "MEASURED" | "UNKNOWN";
    // 값
    value: number | null;
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
    // 측정값의 단위
    unit: "px" | "px_per_s" | "deg";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
};
// 후보와 사건 기록의 별도 출처 연결의 자료 구조 정의
export interface InteractionRecordLink {
    // 일반 후보 식별자
    candidateId: string; observationId: string; incidentId: string; actionId: string;
}
// 일반 상호작용의 비공개 관측 계약의 자료 구조 정의
export interface InteractionObservationV1 {
    // 결과 종류
    kind: "INTERACTION_OBSERVATION";
    // 전송 자료의 구조 버전
    schemaVersion: "interaction-observation-v1";
    // 일반 후보 식별자
    candidateId: string;
    // 시각별 관측 식별자
    observationId: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 정렬상 첫 참여자이며 행위자 의미는 없음
    participantA: Participant;
    // 정렬상 둘째 참여자이며 상대 팀 의미는 없음
    participantB: Participant;
    // 행위 방향과 구분된 참여자 정렬 기준
    pairOrder: "LEXICAL_NOT_DIRECTIONAL";
    // 측정 좌표계와 카메라 보정 여부
    coordinateSpace: "SOURCE_IMAGE_PIXELS_UNCOMPENSATED";
    // 해당 관측의 원본 프레임 정보
    frame: { timestampMs: number; width: number; height: number; [key: string]: unknown };
    // 화면 좌표에서 계산한 측정값
    measurements: Record<string, Measurement>;
    // 관찰된 행위 유형 가설
    actionType: InteractionHypothesis<IncidentActionType>;
    // 행위 주체와 대상의 방향 가설
    direction: InteractionHypothesis<"A_TO_B" | "B_TO_A">;
    // 두 참여자의 소속 팀 관계
    teamRelation: Unknown;
    // 접촉 관측의 확인 상태
    contact: Unknown;
    // 해당 접촉에 의한 이동 방해 관측
    movementImpeded: Unknown;
    // 관측 또는 검사 방법
    method: {
        // 고유 식별자
        id: "interaction-image-measurements-v1";
        // 좌표 측정에 사용할 관절 점수의 최소값
        keypointScoreMinimum: number;
        // 같은 연속 관측으로 연결할 최대 시간 간격
        maxGapMs: number;
    };
    // 원래 상호작용 후보 식별자 목록
    upstreamInteractionIds: readonly string[];
    // 이 관측의 원시 입력 출처
    upstream: { artifactSha256: string; lineNumber: number; rowSha256: string };
    // 관련 영상 근거 목록
    evidence: readonly {
        // 증거 목록에서의 순서
        evidenceIndex: number;
        // 결과 종류
        kind: "FRAME" | "CLIP";
        // 파일 경로
        path: string;
        // 원본 기준 관측 시각
        timestampMs: number;
        // 원본 기준 시작 시각
        startMs: number;
        // 원본 기준 종료 시각
        endMs: number;
        // 파일 내용의 해시
        contentSha256: string;
        // 클립이 전후 측정 구간 전체를 포함하는지 여부
        coversMeasurementWindow: boolean;
    }[];
    // 증거 연결이 부족한 이유
    evidenceReasons: readonly string[];
    // 후보와 유형별 사건 기록의 출처 연결
    recordLinks: readonly InteractionRecordLink[];
}

// 측정 종류별 허용 단위 구성
const units: Record<string, Measurement["unit"]> = {
    // 두 인물 상자 중심 사이의 화면 거리 기록
    centerDistance: "px",
    // 두 인물 상자 사이의 화면 간격 기록
    boxGap: "px",
    // 직전 표본 대비 중심 거리 변화 기록
    centerDistanceChange: "px",
    // 첫 참여자의 화면상 이동량 기록
    participantADisplacement: "px",
    // 첫 참여자의 화면 좌표 속도 기록
    participantASpeed: "px_per_s",
    // 둘째 참여자의 화면상 이동량 기록
    participantBDisplacement: "px",
    // 둘째 참여자의 화면 좌표 속도 기록
    participantBSpeed: "px_per_s",
    // 첫 참여자 왼손목과 둘째 몸통 중심의 화면 거리 기록
    aLeftWristToBTorso: "px",
    // 첫 참여자 오른손목과 둘째 몸통 중심의 화면 거리 기록
    aRightWristToBTorso: "px",
    // 둘째 참여자 왼손목과 첫째 몸통 중심의 화면 거리 기록
    bLeftWristToATorso: "px",
    // 둘째 참여자 오른손목과 첫째 몸통 중심의 화면 거리 기록
    bRightWristToATorso: "px",
    // 첫 참여자의 왼쪽 팔꿈치 각도 기록
    aLeftElbowAngle: "deg",
    // 첫 참여자의 오른쪽 팔꿈치 각도 기록
    aRightElbowAngle: "deg",
    // 둘째 참여자의 왼쪽 팔꿈치 각도 기록
    bLeftElbowAngle: "deg",
    // 둘째 참여자의 오른쪽 팔꿈치 각도 기록
    bRightElbowAngle: "deg"
};
// 검사 전 임의 객체의 자료 구조 정의
type Data = Record<string, unknown>;

// 객체 형식 확인
const obj = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);

// 필수 필드 확인
const keys = (v: unknown, names: readonly string[]): v is Data =>
    obj(v) && Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));

// 문자열 범위 확인
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;

// 해시 형식 확인
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// 시각 범위 확인
const time = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// 배열과 항목 수 제한 확인
const list = (v: unknown, maximum = 128): v is unknown[] =>
    Array.isArray(v) && v.length <= maximum && Object.keys(v).length === v.length;

// 문자열 목록 확인
const texts = (v: unknown): v is string[] => list(v, 32) && v.every(text);

// 미확인 관측 확인
const unknownClaim = (v: unknown): boolean =>
    keys(v, ["state", "value", "reasons"]) &&
    v.state === "UNKNOWN" &&
    v.value === null &&
    texts(v.reasons) &&
    v.reasons.length > 0;

// 가설 형식 확인
const hypothesis = (v: unknown, values: readonly string[], observationId: string): boolean =>
    unknownClaim(v) ||
    (keys(v, ["state", "value", "reasons", "method", "observationIds"]) &&
        v.state === "HYPOTHESIS" &&
        values.includes(v.value as string) &&
        texts(v.reasons) &&
        v.reasons.length > 0 &&
        keys(v.method, ["id", "version"]) &&
        text(v.method.id) &&
        text(v.method.version) &&
        texts(v.observationIds) &&
        v.observationIds.length === 1 &&
        v.observationIds[0] === observationId);

// 참여자 추적 정보 확인
const participant = (v: unknown): v is Participant =>
    keys(v, ["trackId", "continuityId", "segmentId", "identityState"]) &&
    text(v.trackId) &&
    time(v.continuityId) &&
    text(v.segmentId) &&
    v.identityState === "TRACK_FRAGMENT_ONLY";

// 원본 프레임 정보 확인
const frameData = (v: unknown, endMs: number): boolean => {
    // 검사 대상 값 및 원본 기준 관측 시각의 조건에 따라 처리 분기
    if (
        !keys(v, [
            "decodedIndex",
            "streamIndex",
            "pts",
            "timeBase",
            "originPts",
            "originTimeBase",
            "timestampMs",
            "width",
            "height",
            "timestampSource"
        ]) ||
        !time(v.decodedIndex) ||
        !time(v.streamIndex) ||
        !time(v.width) ||
        !v.width ||
        !time(v.height) ||
        !v.height ||
        v.width * v.height > 4096 * 2160 ||
        v.timestampMs !== endMs ||
        v.timestampSource !== "DECODER_PTS" ||
        typeof v.pts !== "number" ||
        !Number.isSafeInteger(v.pts) ||
        typeof v.originPts !== "number" ||
        !Number.isSafeInteger(v.originPts) ||
        !keys(v.timeBase, ["numerator", "denominator"]) ||
        !keys(v.originTimeBase, ["numerator", "denominator"])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 원본 시간 단위 및 시간축 기준점의 단위 참조
    const b = v.timeBase,
        // 시간축 기준점의 단위 확인
        o = v.originTimeBase;
    // 원본 시각 환산식의 분자 및 원본 시각 환산식의 분모의 조건에 따라 처리 분기
    if (![b.numerator, b.denominator, o.numerator, o.denominator].every((n) => time(n) && n > 0))
        // 필수 조건 불충족 결과 반환
        return false;
    // 원본 시각 환산식의 분모 계산
    const denominator = BigInt(b.denominator as number) * BigInt(o.denominator as number);
    // 원본 시각 환산식의 분자 계산
    const numerator =
        (BigInt(v.pts) * BigInt(b.numerator as number) * BigInt(o.denominator as number) -
            BigInt(v.originPts) * BigInt(o.numerator as number) * BigInt(b.denominator as number)) *
        1000n;
    // 원본 시각 환산식의 분자의 조건에 따라 처리 분기
    if (numerator < 0n) return false;
    // 환산한 시각의 정수 부분 및 시각 환산 후 남은 나머지 계산
    const whole = numerator / denominator,
        // 시각 환산 후 남은 나머지 확인
        remainder = numerator % denominator;
    // 반올림한 원본 시각 계산
    const rounded =
        whole +
        (remainder * 2n > denominator || (remainder * 2n === denominator && whole % 2n === 1n)
            ? 1n
            : 0n);
    // 원본 표시 시각에서 계산한 밀리초와 기록된 시각의 일치 여부 반환
    return rounded === BigInt(endMs);
};

// 관측 구조만 검사하며 증거 검증·사실 승인은 별도로 처리
export function interactionData(value: unknown): value is InteractionObservationV1 {
    // 자료 처리 오류를 별도 실패 결과로 구분하기 위한 실행 구간
    try {
        // 관측 자료의 최대 크기와 필수 최상위 필드 확인
        if (
            new TextEncoder().encode(JSON.stringify(value)).length > 1_000_000 ||
            !keys(value, [
                "kind",
                "schemaVersion",
                "candidateId",
                "observationId",
                "sourceSha256",
                "startMs",
                "endMs",
                "participantA",
                "participantB",
                "pairOrder",
                "coordinateSpace",
                "frame",
                "measurements",
                "actionType",
                "direction",
                "teamRelation",
                "contact",
                "movementImpeded",
                "method",
                "upstreamInteractionIds",
                "upstream",
                "evidence",
                "evidenceReasons",
                "recordLinks"
            ])
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 검사 대상 값 참조
        const v = value;
        // 결과 종류 및 전송 자료의 구조 버전의 조건에 따라 처리 분기
        if (
            v.kind !== "INTERACTION_OBSERVATION" ||
            v.schemaVersion !== "interaction-observation-v1" ||
            !text(v.candidateId) ||
            !/^candidate-[a-f0-9]{64}$/.test(v.candidateId) ||
            !text(v.observationId) ||
            !/^observation-[a-f0-9]{64}$/.test(v.observationId) ||
            !sha(v.sourceSha256) ||
            !time(v.startMs) ||
            !time(v.endMs) ||
            v.startMs > v.endMs ||
            !participant(v.participantA) ||
            !participant(v.participantB) ||
            v.participantA.trackId >= v.participantB.trackId ||
            v.participantA.segmentId !== v.participantB.segmentId ||
            v.participantA.continuityId !== v.participantB.continuityId ||
            v.pairOrder !== "LEXICAL_NOT_DIRECTIONAL" ||
            v.coordinateSpace !== "SOURCE_IMAGE_PIXELS_UNCOMPENSATED" ||
            !frameData(v.frame, v.endMs) ||
            !hypothesis(v.actionType, Object.keys(INCIDENT_OBSERVATION_KEYS), v.observationId) ||
            !hypothesis(v.direction, ["A_TO_B", "B_TO_A"], v.observationId) ||
            ![v.teamRelation, v.contact, v.movementImpeded].every(unknownClaim) ||
            !keys(v.method, ["id", "keypointScoreMinimum", "maxGapMs"]) ||
            v.method.id !== "interaction-image-measurements-v1" ||
            v.method.keypointScoreMinimum !== 0.3 ||
            v.method.maxGapMs !== 250 ||
            !texts(v.upstreamInteractionIds) ||
            !v.upstreamInteractionIds.length ||
            !keys(v.upstream, ["artifactSha256", "lineNumber", "rowSha256"]) ||
            !sha(v.upstream.artifactSha256) ||
            !sha(v.upstream.rowSha256) ||
            !time(v.upstream.lineNumber) ||
            v.upstream.lineNumber === 0 ||
            !keys(v.measurements, Object.keys(units)) ||
            !list(v.evidence) ||
            !texts(v.evidenceReasons) ||
            !list(v.recordLinks)
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 항목 이름과 값의 묶음 및 화면 좌표에서 계산한 측정값의 각 항목을 순서대로 검사
        for (const [name, m] of Object.entries(v.measurements)) {
            // 경기 정보 및 측정값의 단위의 조건에 따라 처리 분기
            if (
                !keys(m, ["state", "value", "unit", "startMs", "endMs", "reasons"]) ||
                m.unit !== units[name] ||
                !texts(m.reasons) ||
                !time(m.startMs) ||
                !time(m.endMs) ||
                m.startMs < v.startMs ||
                m.endMs !== v.endMs ||
                m.startMs > m.endMs
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 현재 확인 상태의 조건에 따라 처리 분기
            if (m.state === "UNKNOWN") {
                // 값 및 확인 불가 또는 차단 사유 목록의 조건에 따라 처리 분기
                if (m.value !== null || !m.reasons.length) return false;
            } else if (
                m.state !== "MEASURED" ||
                typeof m.value !== "number" ||
                !Number.isFinite(m.value) ||
                m.reasons.length ||
                (name !== "centerDistanceChange" && m.value < 0) ||
                (m.unit === "deg" && m.value > 180)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
        }
        // 측정에 필요한 가장 이른 시각 구성
        const earliest = Math.min(
            ...Object.values(v.measurements).map((m) => (m as Measurement).startMs)
        );
        // 이미 처리한 순서 집합 보관 공간 생성
        const indices = new Set<number>();
        // 관련 영상 근거 목록의 각 항목을 순서대로 검사
        for (const e of v.evidence) {
            // 증거 목록에서의 순서 및 이미 처리한 순서 집합의 조건에 따라 처리 분기
            if (
                !keys(e, [
                    "evidenceIndex",
                    "kind",
                    "path",
                    "timestampMs",
                    "startMs",
                    "endMs",
                    "contentSha256",
                    "coversMeasurementWindow"
                ]) ||
                !time(e.evidenceIndex) ||
                indices.has(e.evidenceIndex) ||
                !text(e.path) ||
                e.path.startsWith("/") ||
                e.path.split("/").includes("..") ||
                e.path.includes("\\") ||
                !sha(e.contentSha256) ||
                !time(e.startMs) ||
                !time(e.endMs) ||
                e.startMs > e.endMs ||
                !time(e.timestampMs) ||
                (e.kind === "FRAME"
                    ? e.timestampMs !== v.endMs
                    : e.kind !== "CLIP" || e.startMs > v.endMs || e.endMs < v.endMs) ||
                e.coversMeasurementWindow !==
                    (e.kind === "CLIP" && e.startMs <= earliest && e.endMs >= v.endMs)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 이미 처리한 순서 집합 집합에 현재 항목 등록
            indices.add(e.evidenceIndex);
        }
        // 후보와 관측 식별자가 일치하는 사건 출처 연결만 허용
        return v.recordLinks.every(
            (link) =>
                keys(link, ["candidateId", "observationId", "incidentId", "actionId"]) &&
                link.candidateId === v.candidateId &&
                link.observationId === v.observationId &&
                text(link.incidentId) &&
                text(link.actionId)
        );
    } catch {
        // 필수 조건 불충족 결과 반환
        return false;
    }
}

// 원본을 바꾸지 않고 출처 관계만 연결하며 사실 승인은 제외
export function incidentLineage(
    observation: unknown,
    record: IncidentRecordV1,
    actionId: string
): InteractionRecordLink | null {
    // 원본 영상의 내용 해시 및 현재 확인 상태의 조건에 따라 처리 분기
    if (
        !interactionData(observation) ||
        !incidentRecordData(record) ||
        observation.sourceSha256 !== record.sourceSha256 ||
        observation.actionType.state !== "HYPOTHESIS" ||
        observation.direction.state !== "HYPOTHESIS"
    ) {
        // 확인 가능한 결과가 없어 빈 값 반환
        return null;
    }
    // 현재 평가할 행위 조회
    const action = record.actions.find((a) => a.id === actionId);
    // 지원하는 잡기 유형인지 확인
    if (
        !action ||
        action.type !== observation.actionType.value ||
        action.startMs < observation.startMs ||
        action.endMs > observation.endMs
    ) {
        // 확인 가능한 결과가 없어 빈 값 반환
        return null;
    }
    // 관측 방향에 따라 행위 주체와 대상의 추적 정보를 선택
    const [actor, target] =
        observation.direction.value === "A_TO_B"
            ? [observation.participantA, observation.participantB]
            : [observation.participantB, observation.participantA];

    // 행위자 추적 정보와 후보 참여자의 일치 확인
    const matches = (actorId: string | null, p: Participant) =>
        record.actors
            .find((a) => a.id === actorId)
            ?.tracklets.some(
                (t) =>
                    t.trackId === p.trackId &&
                    t.continuityId === String(p.continuityId) &&
                    t.segmentId === p.segmentId &&
                    action.segmentId === p.segmentId
            );
    // 현재 평가할 행위 및 해당 행위의 주체의 조건에 따라 처리 분기
    if (!matches(action.actorId, actor) || !matches(action.targetActorId, target)) return null;
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 일반 후보 식별자 기록
        candidateId: observation.candidateId,
        // 시각별 관측 식별자 기록
        observationId: observation.observationId,
        // 경합 사건 식별자 기록
        incidentId: record.incidentId,
        // 사건 안의 행위 식별자 기록
        actionId
    };
}
