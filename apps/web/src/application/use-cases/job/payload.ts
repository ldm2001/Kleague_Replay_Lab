// 결과 전송 자료 검증 계약 가져옴
import {
    observationData,
    perceptionRefs,
    perceptionRunData,
    trackingData,
    sceneEventData,
    broadcastCueData
} from "@replay/shared-types";
// 전송 자료별 입력 계약 가져옴
import type {
    AnalysisCandidate,
    AnalysisEvidence,
    AnalysisShot,
    JobResultPayload
} from "../../ports/repositories/job-store";

// 실패 코드의 허용 형식 정의
const CODE = /^[A-Z0-9_]{1,64}$/;

// 신뢰 전 입력의 일반 객체 여부 확인
const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// 문자열 여부 확인
const text = (value: unknown): value is string => typeof value === "string";

// 0 이상 안전한 정수 확인
const natural = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// 허용 어휘에 속한 문자열 확인
const word = (value: unknown, words: readonly string[]): value is string =>
    text(value) && words.includes(value);

// 모든 원소가 형식을 만족하는 배열 확인
const list = <T>(value: unknown, item: (entry: unknown) => entry is T): value is readonly T[] =>
    Array.isArray(value) && value.every(item);

// 영상 검증 전송 자료 확인
const validation = (value: Record<string, unknown>): boolean =>
    natural(value.durationMs) &&
    value.durationMs > 0 &&
    natural(value.width) &&
    value.width > 0 &&
    natural(value.height) &&
    value.height > 0;

// 작업자 실패 전송 자료 확인
const failure = (value: Record<string, unknown>): boolean =>
    text(value.failureCode) && CODE.test(value.failureCode) && typeof value.retryable === "boolean";

// 샷 전송 자료 확인
const shot = (value: unknown): value is AnalysisShot =>
    record(value) &&
    natural(value.index) &&
    natural(value.startMs) &&
    natural(value.endMs) &&
    value.endMs >= value.startMs &&
    word(value.playbackSpeed, ["NORMAL", "SLOW", "UNKNOWN"]) &&
    (value.isReplay === null || typeof value.isReplay === "boolean") &&
    (value.cameraAngle === null || text(value.cameraAngle));

// 후보 전송 자료 확인
const candidate = (value: unknown): value is AnalysisCandidate => {
    // 일반 객체와 후보 구간 형식이 아니면 원소 필드 검사 전 거부
    if (!record(value) || !natural(value.startMs) || !natural(value.endMs)) return false;
    // 부가 관측의 구간 포함 검사에 쓰는 후보 경계 고정
    const start = value.startMs;
    const end = value.endMs;
    // 순번과 분류 및 대표 시각과 부가 관측의 구간 포함 결과 반환
    return (
        end >= start &&
        natural(value.index) &&
        value.category === "OTHER" &&
        natural(value.anchorMs) &&
        value.anchorMs >= start &&
        value.anchorMs <= end &&
        typeof value.confidence === "number" &&
        Number.isFinite(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 1 &&
        word(value.cameraSufficiency, ["LOW", "MEDIUM", "HIGH"]) &&
        list(value.reasons, text) &&
        list(value.shotIndices, natural) &&
        (value.tracking == null || trackingData(value.tracking, start, end)) &&
        // 재개 시각과 근거가 제출된 후보 구간 안에 있는지 확인
        (value.sceneEvent == null || sceneEventData(value.sceneEvent, start, end)) &&
        (value.broadcastCue == null || broadcastCueData(value.broadcastCue, start, end)) &&
        // 모델 관찰과 프레임 시각은 후보 구간 안에서만 허용
        (value.observation == null ||
            (observationData(value.observation) &&
                value.observation.timestamps.every((time) => time >= start && time <= end)))
    );
};

// 증거 전송 자료 확인
const evidence = (value: unknown): value is AnalysisEvidence =>
    record(value) &&
    natural(value.candidateIndex) &&
    word(value.kind, ["FRAME", "CLIP"]) &&
    text(value.objectKey) &&
    /^evidence\/[0-9a-f-]+\/[0-9a-f-]+\/(?:[1-9][0-9]*\/[a-f0-9]{64}\/)?[A-Za-z0-9._-]+$/i.test(
        value.objectKey
    ) &&
    text(value.contentSha256) &&
    /^[a-f0-9]{64}$/i.test(value.contentSha256) &&
    natural(value.startMs) &&
    natural(value.endMs) &&
    value.endMs >= value.startMs &&
    (value.kind !== "FRAME" || value.startMs === value.endMs) &&
    (value.width === null || (natural(value.width) && value.width > 0)) &&
    (value.height === null || (natural(value.height) && value.height > 0));

// 분석 전송 자료 확인
const analysis = (value: Record<string, unknown>): boolean => {
    // 처리 버전과 한계 및 화면 구간과 후보와 증거 원소의 형식 확인
    if (
        !text(value.pipelineVersion) ||
        value.pipelineVersion.length === 0 ||
        value.pipelineVersion.length > 64 ||
        !list(value.limitations, text) ||
        !list(value.shots, shot) ||
        !list(value.candidates, candidate) ||
        (value.evidence !== undefined &&
            (!list(value.evidence, evidence) || value.evidence.length > 128))
    ) {
        // 기본 처리 자료 계약 위반 시 추가 관측 검사 없이 거부 반환
        return false;
    }
    // 생략한 증거 목록을 빈 목록으로 정규화
    const items = value.evidence ?? [];
    // 처리 절차에 맞는 관측 자료 구조 버전 선택
    const schemaVersion =
        value.pipelineVersion === "video-local-observers-v1"
            ? "perception-run-v1"
            : value.pipelineVersion === "video-local-observers-av-v1"
              ? "perception-run-v2"
              : null;
    // 비관측 처리 버전에서는 관측 자료가 섞이지 않았는지 확인
    if (schemaVersion === null) return value.perception === undefined;
    // 처리 절차에 대응하지 않는 관측 자료 버전 거부
    if (!record(value.perception) || value.perception.schemaVersion !== schemaVersion) return false;
    // 화면 구간과 후보 순번 및 증거 경로 중복 확인
    if (
        new Set(value.shots.map((item) => item.index)).size !== value.shots.length ||
        new Set(value.candidates.map((item) => item.index)).size !== value.candidates.length ||
        new Set(items.map((item) => item.objectKey)).size !== items.length
    ) {
        // 중복으로 모호해진 결과 연결 거부 반환
        return false;
    }
    // 관측 구조와 후보 및 증거 참조의 유효성 검사 결과 반환
    return (
        perceptionRunData(value.perception) &&
        perceptionRefs(value.perception, value.candidates, items)
    );
};

// 결과 유형별 전송 자료 확인
export const payload = (value: unknown): value is JobResultPayload =>
    record(value) &&
    (value.kind === "VALIDATED"
        ? validation(value)
        : value.kind === "ANALYZED"
            ? analysis(value)
            : value.kind === "FAILED" && failure(value));
