// 규정 인용 자료형 가져오기
import type { RuleCitation } from "./citation";

// 규정 필터의 차단 사유의 자료 구조 정의
export type PipelineFilterReason =
    | "INVALID_INTERVAL"
    | "INVALID_TRACKING"
    | "INVALID_SCENE_EVENT"
    | "SCENE_EVENT_UNAVAILABLE"
    | "SITUATION_OBSERVED"
    | "RULE_CLAUSES_UNAVAILABLE"
    | "TRACKING_UNAVAILABLE"
    | "TRACKING_INCOMPLETE"
    | "CAMERA_MOTION_UNVERIFIED"
    | "EVIDENCE_UNAVAILABLE"
    | "RULE_CONTEXT_UNVERIFIED"
    | "INCIDENT_UNCLASSIFIED"
    | "CONTACT_UNOBSERVED"
    | "INTENSITY_UNOBSERVED";

// 영상 안의 재개 관찰이며 실제 경기 시각이나 원심의 적법성을 확정 제외
export type SceneEvent = Readonly<{
    // 결과 종류
    kind: "CORNER_KICK";
    // 현재 처리 상태
    status: "OBSERVED";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 관측된 재개 시각
    restartMs: number;
    // 근거가 되는 원본 시각 목록
    evidenceTimestampsMs: readonly number[];
    // 관측 또는 검사 방법
    method: "corner-geometry-motion-v1";
}>;

// 요청 경로 수신과 저장된 결과의 재평가가 같은 시간 범위 계약을 사용
export function sceneEventData(
    value: unknown,
    startMs: number,
    endMs: number
): value is SceneEvent {
    // 재개 상황이 일반 객체 형태인지 확인
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // 구조 검사를 통과한 입력을 상황 관측 객체로 참조
    const item = value as Record<string, unknown>;

    // 시각 범위 확인
    const time = (n: unknown): n is number =>
        typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    // 후보 구간과 재개 상황의 필수 시각 및 근거 목록 확인
    if (
        !time(startMs) ||
        !time(endMs) ||
        endMs <= startMs ||
        item.kind !== "CORNER_KICK" ||
        item.status !== "OBSERVED" ||
        item.method !== "corner-geometry-motion-v1" ||
        !time(item.startMs) ||
        !time(item.endMs) ||
        !time(item.restartMs) ||
        item.startMs < startMs ||
        item.endMs > endMs ||
        item.restartMs <= item.startMs ||
        item.restartMs >= item.endMs ||
        !Array.isArray(item.evidenceTimestampsMs) ||
        item.evidenceTimestampsMs.length < 2 ||
        item.evidenceTimestampsMs.length > 256
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 경기 상황의 관측 시작 시각 참조
    const eventStart = item.startMs;
    // 경기 상황의 관측 종료 시각 참조
    const eventEnd = item.endMs;
    // 근거 시각 목록 참조
    const times = item.evidenceTimestampsMs;
    // 근거 시각이 올바른 순서로 상황 구간 안에 포함되는지 반환
    return (
        times.every(
            (value, index) =>
                time(value) &&
                value >= eventStart &&
                value <= eventEnd &&
                (index === 0 || value > times[index - 1])
        ) &&
        times[0] < item.restartMs &&
        times[times.length - 1] >= item.restartMs
    );
}

// 규정 적용에 필요한 조건의 자료 구조 정의
export type PipelineRuleCondition = Readonly<{
    // 처리 결과 코드
    code: "CORNER_PLACEMENT" | "CORNER_RESTART" | "CORNER_DISTANCE" | "DIRECT_CORNER_OFFSIDE";
    // 자료의 용도 설명
    description: string;
    // 현재 처리 상태
    status: "UNVERIFIED";
    // 규정의 법 조항
    law: string;
    // 규정의 세부 항목
    section: string;
    // 원문 주소
    sourceUrl: string;
}>;

// 상황 인식과 규정 연결을 조건 충족 및 반칙 판정과 구분
export type PipelineFilterResult = Readonly<{
    // 규정 필터의 버전
    filterVersion: string;
    // 현재 처리 상태
    status: "EXCLUDED" | "UNDETERMINED" | "OBSERVED" | "APPLICABLE";
    // 처리 상태를 설명하는 사유 코드
    reasonCodes: readonly PipelineFilterReason[];
    // 확인이 필요한 입력 항목
    missingFields: readonly string[];
    // 연결된 규정 조항 목록
    ruleReferences: readonly RuleCitation[];
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 추적 결과의 신뢰 수준
    trackingStatus?:
        "UNAVAILABLE" | "PARTIAL" | "POSITION_ONLY" | "CAMERA_COMPENSATED" | "MOTION_ONSET";
    // 관측한 경기 상황
    situation?: "CORNER_KICK";
    // 적용을 확정하지 않은 참고 범주
    referenceOnly?: boolean;
    // 개별 규정의 적용 조건
    conditions?: readonly PipelineRuleCondition[];
}>;
