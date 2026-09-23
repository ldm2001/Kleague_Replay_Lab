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
    AnalysisPayload,
    AnalysisShot,
    JobFailurePayload,
    JobResultPayload,
    ValidationPayload
} from "../../ports/repositories/job-store";

// 실패 코드의 허용 형식 정의
const CODE = /^[A-Z0-9_]{1,64}$/;

// 영상 검증 전송 자료 확인
const validation = (payload: ValidationPayload): boolean =>
    Number.isSafeInteger(payload.durationMs) &&
    payload.durationMs > 0 &&
    Number.isSafeInteger(payload.width) &&
    payload.width > 0 &&
    Number.isSafeInteger(payload.height) &&
    payload.height > 0;

// 작업자 실패 전송 자료 확인
const failure = (payload: JobFailurePayload): boolean =>
    CODE.test(payload.failureCode) && typeof payload.retryable === "boolean";

// 샷 전송 자료 확인
const shot = (value: AnalysisShot): boolean =>
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    Number.isSafeInteger(value.startMs) &&
    value.startMs >= 0 &&
    Number.isSafeInteger(value.endMs) &&
    value.endMs >= value.startMs &&
    ["NORMAL", "SLOW", "UNKNOWN"].includes(value.playbackSpeed) &&
    (value.isReplay === null || typeof value.isReplay === "boolean") &&
    (value.cameraAngle === null || typeof value.cameraAngle === "string");

// 후보 전송 자료 확인
const candidate = (value: AnalysisCandidate): boolean =>
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    value.category === "OTHER" &&
    Number.isSafeInteger(value.startMs) &&
    value.startMs >= 0 &&
    Number.isSafeInteger(value.endMs) &&
    value.endMs >= value.startMs &&
    Number.isSafeInteger(value.anchorMs) &&
    value.anchorMs >= value.startMs &&
    value.anchorMs <= value.endMs &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    ["LOW", "MEDIUM", "HIGH"].includes(value.cameraSufficiency) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    Array.isArray(value.shotIndices) &&
    value.shotIndices.every((index) => Number.isSafeInteger(index) && index >= 0) &&
    (value.tracking == null || trackingData(value.tracking, value.startMs, value.endMs)) &&
    // 재개 시각과 근거가 제출된 후보 구간 안에 있는지 확인
    (value.sceneEvent == null || sceneEventData(value.sceneEvent, value.startMs, value.endMs)) &&
    (value.broadcastCue == null ||
        broadcastCueData(value.broadcastCue, value.startMs, value.endMs)) &&
    // 모델 관찰과 프레임 시각은 후보 구간 안에서만 허용
    (value.observation == null ||
        (observationData(value.observation) &&
            value.observation.timestamps.every(
                (time) => time >= value.startMs && time <= value.endMs
            )));

// 증거 전송 자료 확인
const evidence = (value: AnalysisEvidence): boolean =>
    Number.isSafeInteger(value.candidateIndex) &&
    value.candidateIndex >= 0 &&
    ["FRAME", "CLIP"].includes(value.kind) &&
    /^evidence\/[0-9a-f-]+\/[0-9a-f-]+\/(?:[1-9][0-9]*\/[a-f0-9]{64}\/)?[A-Za-z0-9._-]+$/i.test(
        value.objectKey
    ) &&
    /^[a-f0-9]{64}$/i.test(value.contentSha256) &&
    Number.isSafeInteger(value.startMs) &&
    value.startMs >= 0 &&
    Number.isSafeInteger(value.endMs) &&
    value.endMs >= value.startMs &&
    (value.width === null || (Number.isSafeInteger(value.width) && value.width > 0)) &&
    (value.height === null || (Number.isSafeInteger(value.height) && value.height > 0));

// 분석 전송 자료 확인
const analysis = (value: AnalysisPayload): boolean => {
    // 처리 버전과 후보 및 증거 자료의 기본 계약 확인
    const valid =
        typeof value.pipelineVersion === "string" &&
        value.pipelineVersion.length > 0 &&
        value.pipelineVersion.length <= 64 &&
        Array.isArray(value.limitations) &&
        value.limitations.every((item) => typeof item === "string") &&
        Array.isArray(value.shots) &&
        value.shots.every(shot) &&
        Array.isArray(value.candidates) &&
        value.candidates.every(candidate) &&
        (value.evidence === undefined ||
            (Array.isArray(value.evidence) &&
                value.evidence.length <= 128 &&
                value.evidence.every(evidence)));
    // 기본 처리 자료 계약을 위반하면 추가 관측 검사 중단
    if (!valid) return false;
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
    if (value.perception?.schemaVersion !== schemaVersion) return false;
    // 화면 구간과 후보 순번 및 증거 경로 중복 확인
    if (
        new Set(value.shots.map((item) => item.index)).size !== value.shots.length ||
        new Set(value.candidates.map((item) => item.index)).size !== value.candidates.length ||
        new Set((value.evidence ?? []).map((item) => item.objectKey)).size !==
            (value.evidence ?? []).length
    ) {
        // 중복으로 모호해진 결과 연결 거부 반환
        return false;
    }
    // 관측 구조와 후보 및 증거 참조의 유효성 검사 결과 반환
    return (
        perceptionRunData(value.perception) &&
        perceptionRefs(value.perception, value.candidates, value.evidence ?? [])
    );
};

// 결과 유형별 전송 자료 확인
export const payload = (value: JobResultPayload): boolean =>
    value.kind === "VALIDATED"
        ? validation(value)
        : value.kind === "ANALYZED"
            ? analysis(value)
            : value.kind === "FAILED" && failure(value);
