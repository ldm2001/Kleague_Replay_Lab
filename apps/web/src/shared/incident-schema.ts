// 사건 관측 자료형 가져오기
import {
    INCIDENT_CONTEXT_KEYS,
    INCIDENT_OBSERVATION_KEYS,
    type IncidentActionType,
    type IncidentRecordV1
} from "./incident";
// 공통 상태 값 목록 가져오기
import { DISCIPLINARY_ACTIONS, GOAL_DECISIONS, RESTART_TYPES } from "./vocabulary";

// 검사 전 임의 객체의 자료 구조 정의
type Data = Record<string, unknown>;

// 문자열 범위 확인
const text = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0 && v.length <= 256;

// 미확정 또는 유효한 문자열 확인
const nullableText = (v: unknown) => v === null || text(v);

// 시각 범위 확인
const time = (v: unknown): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// 해시 형식 확인
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// 실제 달력에 존재하는 날짜 확인
const calendarDate = (v: unknown) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)) &&
    new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;

// 허용 목록에 포함된 값 확인
const oneOf = (v: unknown, values: readonly string[]) =>
    typeof v === "string" && values.includes(v);

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

// 배열의 항목 수 제한 확인
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;

// 시작과 종료 시각 순서 확인
const span = (v: Data) => time(v.startMs) && time(v.endMs) && v.startMs <= v.endMs;
// 모든 관측에 공통으로 필요한 근거 항목 구성
const proofKeys = ["id", "state", "origin", "method", "evidenceIds", "confidence", "reasons"];

// 사건 구조와 크기만 검사하며 근거 승인·규정 평가는 별도로 처리
export function incidentRecordData(value: unknown): value is IncidentRecordV1 {
    // 자료 처리 오류를 별도 실패 결과로 구분하기 위한 실행 구간
    try {
        // 의미 검사 전 순환 참조와 직렬화 불가 값 및 과도한 중첩 차단
        let budget = 1_000_000;
        // 현재 방문 중인 객체 집합 보관 공간 생성
        const active = new Set<object>();

        // 순환 참조·중첩 깊이·자료 크기 제한 확인
        function bounded(v: unknown, depth: number): boolean {
            // 검사 크기와 중첩 깊이가 제한을 넘는지 확인
            if (--budget < 0 || depth > 16) return false;
            // 빈 값과 불리언은 추가 순환 검사 없이 허용
            if (v === null || typeof v === "boolean") return true;
            // 숫자는 무한대나 비수치 값이 아닌 경우에만 허용
            if (typeof v === "number") return Number.isFinite(v);
            // 문자열 입력의 길이와 검사 예산 확인
            if (typeof v === "string") {
                // 남은 자료 검사 예산 갱신
                budget -= v.length;
                // 남은 자료 검사 예산 및 검사 대상 값을 반영한 결과 반환
                return budget >= 0 && v.length <= 1024;
            }
            // 이미 방문한 객체의 순환 참조 차단
            if (typeof v !== "object" || active.has(v)) return false;

            // 현재 방문 중인 객체 집합 집합에 현재 항목 등록
            active.add(v);
            // 검사 조건 충족 여부 준비
            let ok: boolean;

            // 배열과 일반 객체의 검증 경로 분리
            if (Array.isArray(v)) {
                // 검사 조건 충족 여부 갱신
                ok =
                    v.length <= 4096 &&
                    Reflect.ownKeys(v).length === v.length + 1 &&
                    Array.from(
                        { length: v.length },
                        (_, i) => Object.hasOwn(v, i) && bounded(v[i], depth + 1)
                    ).every(Boolean);
            } else {
                // 검사 조건 충족 여부 갱신
                ok =
                    object(v) &&
                    Reflect.ownKeys(v).length <= 64 &&
                    Reflect.ownKeys(v).every(
                        (k) =>
                            typeof k === "string" &&
                            bounded(k, depth + 1) &&
                            bounded(v[k], depth + 1)
                    );
            }

            // 현재 방문 중인 객체 집합 현재 항목의 검사 기록 정리
            active.delete(v);
            // 검사 조건 충족 여부 반환
            return ok;
        }

        // 순환·중첩 검사 실패와 직렬화 크기 초과 입력 거절
        if (
            !bounded(value, 0) ||
            new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_000_000
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 값 및 전송 자료의 구조 버전의 조건에 따라 처리 분기
        if (
            !keys(value, [
                "schemaVersion",
                "incidentId",
                "sourceSha256",
                "match",
                "segments",
                "evidence",
                "actors",
                "links",
                "actions",
                "refereeDecisions"
            ]) ||
            value.schemaVersion !== "incident-record-v1" ||
            !text(value.incidentId) ||
            !sha(value.sourceSha256)
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 경기 정보 참조
        const m = value.match;
        // 경기 정보의 필수 항목 구성
        const matchKeys = ["matchId", "competition", "season", "matchDate", "ifabVersionId"];
        // 경기 정보 및 경기 정보의 필수 항목의 조건에 따라 처리 분기
        if (
            !keys(m, [...matchKeys, "verification"]) ||
            !oneOf(m.verification, ["VERIFIED", "UNVERIFIED"]) ||
            !matchKeys.every((k) => nullableText(m[k])) ||
            (m.verification === "VERIFIED" && !matchKeys.every((k) => text(m[k])))
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 경기 날짜의 조건에 따라 처리 분기
        if (m.matchDate !== null && !calendarDate(m.matchDate)) return false;
        // 식별자로 조회할 영상 구간 및 관련 영상 근거 목록의 조건에 따라 처리 분기
        if (
            !list(value.segments, 256) ||
            !value.segments.length ||
            !list(value.evidence, 2048) ||
            !list(value.actors, 256) ||
            !list(value.links, 512) ||
            !list(value.actions, 256) ||
            !list(value.refereeDecisions, 128)
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 이미 사용된 식별자 집합 보관 공간 생성
        const ids = new Set<string>([value.incidentId]);

        // 중복 없는 식별자 확인과 등록
        function id(v: unknown): v is string {
            // 검사 대상 값 및 이미 사용된 식별자 집합의 조건에 따라 처리 분기
            if (!text(v) || ids.has(v)) return false;
            // 이미 사용된 식별자 집합 집합에 현재 항목 등록
            ids.add(v);
            // 모든 필수 조건 충족 결과 반환
            return true;
        }
        // 식별자로 조회할 영상 구간 보관 공간 생성
        const segments = new Map<string, Data>();
        // 식별자로 조회할 영상 구간의 각 항목을 순서대로 검사
        for (const s of value.segments) {
            // 현재 영상 구간 및 고유 식별자의 조건에 따라 처리 분기
            if (
                !keys(s, [
                    "id",
                    "shotId",
                    "cameraId",
                    "startMs",
                    "endMs",
                    "playbackSpeed",
                    "replayState",
                    "matchClockMs"
                ]) ||
                !id(s.id) ||
                !text(s.shotId) ||
                !nullableText(s.cameraId) ||
                !span(s) ||
                s.startMs === s.endMs ||
                !oneOf(s.playbackSpeed, ["NORMAL", "SLOW", "UNKNOWN"]) ||
                !oneOf(s.replayState, ["LIVE", "REPLAY", "UNKNOWN"]) ||
                !(s.matchClockMs === null || time(s.matchClockMs))
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 식별자로 조회할 영상 구간 식별자와 값을 연결해 저장
            segments.set(s.id, s);
        }

        // 관측 구간이 원본 샷에 포함되는지 확인
        function contained(v: Data): boolean {
            // 현재 영상 구간 조회
            const s = typeof v.segmentId === "string" ? segments.get(v.segmentId) : undefined;
            // 현재 영상 구간 및 검사 대상 값을 반영한 결과 반환
            return (
                !!s &&
                span(v) &&
                (v.startMs as number) >= (s.startMs as number) &&
                (v.endMs as number) <= (s.endMs as number)
            );
        }
        // 관련 영상 근거 목록 보관 공간 생성
        const evidence = new Set<string>();
        // 관련 영상 근거 목록의 각 항목을 순서대로 검사
        for (const e of value.evidence) {
            // 고유 식별자 및 결과 종류의 조건에 따라 처리 분기
            if (
                !keys(e, ["id", "segmentId", "kind", "startMs", "endMs", "contentSha256"]) ||
                !id(e.id) ||
                !oneOf(e.kind, ["FRAME", "CLIP"]) ||
                !contained(e) ||
                (e.kind === "CLIP" && e.startMs === e.endMs) ||
                !sha(e.contentSha256)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 관련 영상 근거 목록 집합에 현재 항목 등록
            evidence.add(e.id);
        }

        // 관측 출처와 증거 참조 확인
        function proof(v: Data): boolean {
            // 관측 방법과 증거 참조 및 신뢰도·사유 형식 확인 결과 반환
            return (
                id(v.id) &&
                oneOf(v.origin, ["IMAGE_MEASUREMENT", "MODEL_ESTIMATE", "EVENT_LINK"]) &&
                keys(v.method, ["id", "version"]) &&
                text(v.method.id) &&
                text(v.method.version) &&
                list(v.evidenceIds, 128) &&
                v.evidenceIds.every((e) => typeof e === "string" && evidence.has(e)) &&
                new Set(v.evidenceIds).size === v.evidenceIds.length &&
                (v.confidence === null ||
                    (typeof v.confidence === "number" &&
                        Number.isFinite(v.confidence) &&
                        v.confidence >= 0 &&
                        v.confidence <= 1)) &&
                list(v.reasons, 32) &&
                v.reasons.every(
                    (r) => typeof r === "string" && r.trim().length > 0 && r.length <= 1024
                )
            );
        }

        // 관측 상태별 증거와 사유 확인
        function assertion(v: unknown): boolean {
            // 검사 대상 값 및 모든 관측에 공통으로 필요한 근거 항목의 조건에 따라 처리 분기
            if (
                !keys(v, proofKeys) ||
                !oneOf(v.state, ["CONFIRMED", "REFUTED", "UNKNOWN", "NOT_APPLICABLE"]) ||
                !proof(v)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 조건에 맞는 결과와 대체 결과 중 하나를 선택해 반환
            return v.state === "CONFIRMED" || v.state === "REFUTED"
                ? (v.evidenceIds as unknown[]).length > 0 && (v.reasons as unknown[]).length === 0
                : (v.reasons as unknown[]).length > 0;
        }

        // 필수 관측 항목별 구조 확인
        function assertions(v: unknown, names: readonly string[]): boolean {
            // 요구한 모든 관측 항목이 올바른 상태와 근거 구조를 갖는지 반환
            return keys(v, names) && names.every((k) => assertion(v[k]));
        }
        // 이미 등록된 인물 식별자 보관 공간 생성
        const actors = new Set<string>();
        // 중복을 방지할 구간별 추적 정보 보관 공간 생성
        const tracklets = new Set<string>();
        // 이미 등록된 인물 식별자의 각 항목을 순서대로 검사
        for (const a of value.actors) {
            // 고유 식별자 및 소속 팀 식별자의 조건에 따라 처리 분기
            if (
                !keys(a, ["id", "tracklets", "teamId", "teamAssignment"]) ||
                !id(a.id) ||
                !nullableText(a.teamId) ||
                !assertion(a.teamAssignment) ||
                ((a.teamAssignment as Data).state === "CONFIRMED") !== (a.teamId !== null) ||
                !list(a.tracklets, 256)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 중복을 방지할 구간별 추적 정보의 각 항목을 순서대로 검사
            for (const t of a.tracklets) {
                // 관측 영상 구간 식별자 및 식별자로 조회할 영상 구간의 조건에 따라 처리 분기
                if (
                    !keys(t, ["segmentId", "continuityId", "trackId"]) ||
                    typeof t.segmentId !== "string" ||
                    !segments.has(t.segmentId) ||
                    !text(t.continuityId) ||
                    !text(t.trackId)
                ) {
                    // 필수 조건 불충족 결과 반환
                    return false;
                }
                // 중복 검사용 추적 정보 조합 확인
                const tuple = JSON.stringify([t.segmentId, t.continuityId, t.trackId]);
                // 중복을 방지할 구간별 추적 정보 및 중복 검사용 추적 정보 조합의 조건에 따라 처리 분기
                if (tracklets.has(tuple)) return false;
                // 중복을 방지할 구간별 추적 정보 집합에 현재 항목 등록
                tracklets.add(tuple);
            }
            // 이미 등록된 인물 식별자 집합에 현재 항목 등록
            actors.add(a.id);
        }
        // 구간 또는 사건 사이의 연결 근거의 각 항목을 순서대로 검사
        for (const l of value.links) {
            // 고유 식별자 및 식별자로 조회할 영상 구간의 조건에 따라 처리 분기
            if (
                !keys(l, ["id", "firstSegmentId", "secondSegmentId", "relation", "assessment"]) ||
                !id(l.id) ||
                typeof l.firstSegmentId !== "string" ||
                !segments.has(l.firstSegmentId) ||
                typeof l.secondSegmentId !== "string" ||
                !segments.has(l.secondSegmentId) ||
                l.firstSegmentId === l.secondSegmentId ||
                !oneOf(l.relation, ["SAME_INCIDENT", "BEFORE", "AFTER", "SIMULTANEOUS"]) ||
                !assertion(l.assessment)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
        }
        // 측정 종류별 허용 단위 구성
        const units = {
            // 화면 거리 측정에 픽셀 단위 연결
            IMAGE_DISTANCE: "px",
            // 화면 속도 측정에 초당 픽셀 단위 연결
            IMAGE_SPEED: "px_per_s",
            // 각도 측정에 도 단위 연결
            ANGLE: "deg",
            // 시간 측정에 밀리초 단위 연결
            DURATION: "ms"
        };

        // 측정값의 단위·상태·근거 확인
        function measurement(v: unknown): boolean {
            // 검사 대상 값 및 모든 관측에 공통으로 필요한 근거 항목의 조건에 따라 처리 분기
            if (
                !keys(v, [...proofKeys, "quantity", "value", "unit"]) ||
                !proof(v) ||
                !oneOf(v.quantity, Object.keys(units)) ||
                v.unit !== units[v.quantity as keyof typeof units]
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 조건에 맞는 결과와 대체 결과 중 하나를 선택해 반환
            return v.state === "KNOWN"
                ? typeof v.value === "number" &&
                      Number.isFinite(v.value) &&
                      (v.evidenceIds as unknown[]).length > 0 &&
                      (v.reasons as unknown[]).length === 0
                : v.state === "UNKNOWN" && v.value === null && (v.reasons as unknown[]).length > 0;
        }
        // 한 사건에서 관찰한 여러 행위의 각 항목을 순서대로 검사
        for (const a of value.actions) {
            // 고유 식별자 및 자료 또는 행위 종류의 조건에 따라 처리 분기
            if (
                !keys(a, [
                    "id",
                    "type",
                    "actorId",
                    "targetActorId",
                    "segmentId",
                    "startMs",
                    "endMs",
                    "context",
                    "observations",
                    "measurements"
                ]) ||
                !id(a.id) ||
                !oneOf(a.type, Object.keys(INCIDENT_OBSERVATION_KEYS)) ||
                typeof a.actorId !== "string" ||
                !actors.has(a.actorId) ||
                !(a.targetActorId === null
                    ? a.type === "HAND_ARM_BALL_CONTACT"
                    : typeof a.targetActorId === "string" &&
                      actors.has(a.targetActorId) &&
                      a.targetActorId !== a.actorId) ||
                !contained(a) ||
                !assertions(a.context, INCIDENT_CONTEXT_KEYS) ||
                !assertions(
                    a.observations,
                    INCIDENT_OBSERVATION_KEYS[a.type as IncidentActionType]
                ) ||
                !list(a.measurements, 128) ||
                !a.measurements.every(measurement)
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
        }
        // 시점별 실제 주심 판정 관측의 각 항목을 순서대로 검사
        for (const d of value.refereeDecisions) {
            // 고유 식별자 및 원심 변경 전후의 판정 단계의 조건에 따라 처리 분기
            if (
                !keys(d, [
                    "id",
                    "phase",
                    "segmentId",
                    "startMs",
                    "endMs",
                    "restartType",
                    "restartBeneficiaryTeamId",
                    "card",
                    "goalDecision",
                    "observations"
                ]) ||
                !id(d.id) ||
                !oneOf(d.phase, ["INITIAL", "REVISED", "FINAL", "UNKNOWN"]) ||
                !contained(d) ||
                !(d.restartType === null || oneOf(d.restartType, RESTART_TYPES)) ||
                !nullableText(d.restartBeneficiaryTeamId) ||
                !(d.card === null || oneOf(d.card, DISCIPLINARY_ACTIONS)) ||
                !(d.goalDecision === null || oneOf(d.goalDecision, GOAL_DECISIONS)) ||
                !assertions(d.observations, ["restart", "beneficiary", "card", "goal"])
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 경기 재개 방식 및 득점 인정 여부에 대한 관측의 조건에 따라 처리 분기
            if (d.restartType === "UNKNOWN" || d.goalDecision === "UNKNOWN") return false;
            // 판정 관측의 확인 상태와 실제 값의 유무를 항목별로 대조
            for (const [claim, field] of [
                ["restart", "restartType"],
                ["beneficiary", "restartBeneficiaryTeamId"],
                ["card", "card"],
                ["goal", "goalDecision"]
            ]) {
                // 현재 확인 상태의 조건에 따라 처리 분기
                if (
                    (((d.observations as Data)[claim!] as Data).state === "CONFIRMED") !==
                    (d[field!] !== null)
                ) {
                    // 필수 조건 불충족 결과 반환
                    return false;
                }
            }
        }
        // 모든 필수 조건 충족 결과 반환
        return true;
    } catch {
        // 필수 조건 불충족 결과 반환
        return false;
    }
}
