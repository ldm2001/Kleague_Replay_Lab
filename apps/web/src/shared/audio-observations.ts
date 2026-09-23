// 원본 시간축에 결합한 음향 관측의 자료 구조 정의
export type AudioObservations = Readonly<{
    // 확인할 버전
    version: "audio-observations-v1";
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 현재 처리 상태
    status: "COMPLETE" | "ABSENT" | "UNSUPPORTED" | "FAILED";
    // 관측 또는 검사 방법
    method: "spectral-multitone-v1";
    // 음성 발화 분석의 수행 여부
    speechStatus: "NOT_ANALYZED";
    // 원본 음향 표본 주파수
    sourceSampleRateHz: number | null;
    // 원본 음향 채널 수
    sourceChannels: number | null;
    // 원본 시간축과 처리 범위
    timeline: Readonly<{
        // 영상 시간축의 기준 시작점
        videoOriginSeconds: number | null;
        // 영상 기준 음향 시작 시차
        audioOffsetMs: number | null;
        // 실제로 조사한 시작 시각
        scannedStartMs: number | null;
        // 실제로 조사한 종료 시각
        scannedEndMs: number | null;
        // 원본에서 디코딩한 프레임 수
        decodedFrameCount: number;
        // 음향 분석 프레임 길이
        frameDurationMs: 100;
        // 누락된 시간 구간의 보존 방식
        gapPolicy: "PRESERVED_WITH_SYNTHETIC_SILENCE";
    }>;
    // 발견한 원시 단서 수
    cueCount: number;
    // 영상 또는 음향 단서 목록
    cues: readonly Readonly<{
        // 고유 식별자
        id: string;
        // 원본 기준 시작 시각
        startMs: number;
        // 원본 기준 종료 시각
        endMs: number;
        // 관측한 주요 음향 주파수
        peakFrequenciesHz: readonly number[];
        // 처리한 프레임 수
        frameCount: number;
    }>[];
    // 단서와 후보 구간의 시간 연결
    associations: readonly Readonly<{
        // 원시 단서 식별자
        cueId: string;
        // 기존 영상 후보의 순서
        candidateIndex: number;
        // 기존 보고서의 증거 순서 목록
        evidenceIndices: readonly number[];
        // 두 구간이나 관측 사이의 관계
        relation: "TEMPORAL_OVERLAP_ONLY";
    }>[];
    // 전체 항목 중 일부만 보존됐는지 여부
    truncated: boolean;
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}>;

// 파일 해시의 허용 형식 정의
const SHA256 = /^[a-f0-9]{64}$/;

// 안전한 비음수 정수 확인
const safe = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// 부호가 있는 안전한 정수 확인
const signedSafe = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value);

// 유한한 숫자인지 확인
const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

// 객체 형식 확인
const object = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// 원본 음향 관측의 구간·상태·근거 형식 확인
export const audioObservationsData = (
    value: unknown,
    sourceSha256: string,
    sourceDurationMs: number
): value is AudioObservations => {
    // 원본 길이와 음향 관측의 최상위 필드 확인
    if (
        !safe(sourceDurationMs) ||
        !object(value, [
            "version",
            "sourceSha256",
            "status",
            "method",
            "speechStatus",
            "sourceSampleRateHz",
            "sourceChannels",
            "timeline",
            "cueCount",
            "cues",
            "associations",
            "truncated",
            "reasons"
        ])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 원본 해시와 음향 처리 상태 및 발화 미분석 계약 확인
    if (
        value.version !== "audio-observations-v1" ||
        value.sourceSha256 !== sourceSha256 ||
        !SHA256.test(sourceSha256) ||
        !["COMPLETE", "ABSENT", "UNSUPPORTED", "FAILED"].includes(value.status as string) ||
        value.method !== "spectral-multitone-v1" ||
        value.speechStatus !== "NOT_ANALYZED" ||
        !(
            value.sourceSampleRateHz === null ||
            (safe(value.sourceSampleRateHz) && value.sourceSampleRateHz > 0)
        ) ||
        !(
            value.sourceChannels === null ||
            (safe(value.sourceChannels) && value.sourceChannels >= 1 && value.sourceChannels <= 32)
        ) ||
        !safe(value.cueCount) ||
        typeof value.truncated !== "boolean" ||
        !Array.isArray(value.reasons) ||
        value.reasons.length > 32 ||
        !value.reasons.every(
            (reason) => typeof reason === "string" && reason.length > 0 && reason.length <= 128
        ) ||
        !object(value.timeline, [
            "videoOriginSeconds",
            "audioOffsetMs",
            "scannedStartMs",
            "scannedEndMs",
            "decodedFrameCount",
            "frameDurationMs",
            "gapPolicy"
        ])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }

    // 원본 시간축과 처리 범위 참조
    const timeline = value.timeline;
    // 영상 시간축의 기준 시작점 및 영상 기준 음향 시작 시차의 조건에 따라 처리 분기
    if (
        !(timeline.videoOriginSeconds === null || finite(timeline.videoOriginSeconds)) ||
        !(timeline.audioOffsetMs === null || signedSafe(timeline.audioOffsetMs)) ||
        !(
            timeline.scannedStartMs === null ||
            (safe(timeline.scannedStartMs) && timeline.scannedStartMs <= sourceDurationMs)
        ) ||
        !(
            timeline.scannedEndMs === null ||
            (safe(timeline.scannedEndMs) && timeline.scannedEndMs <= sourceDurationMs)
        ) ||
        (timeline.scannedStartMs === null) !== (timeline.scannedEndMs === null) ||
        (typeof timeline.scannedStartMs === "number" &&
            typeof timeline.scannedEndMs === "number" &&
            timeline.scannedEndMs < timeline.scannedStartMs) ||
        !safe(timeline.decodedFrameCount) ||
        timeline.frameDurationMs !== 100 ||
        timeline.gapPolicy !== "PRESERVED_WITH_SYNTHETIC_SILENCE"
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }

    // 단서·시간 연결·사유 목록의 개수 제한과 자료형 확인
    if (
        !Array.isArray(value.cues) ||
        value.cues.length > 256 ||
        !Array.isArray(value.associations) ||
        value.associations.length > 512 ||
        value.cueCount < value.cues.length ||
        (value.cueCount > value.cues.length && !value.truncated)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 현재 처리 상태 및 원본 음향 표본 주파수의 조건에 따라 처리 분기
    if (
        value.status === "ABSENT" &&
        (value.sourceSampleRateHz !== null ||
            value.sourceChannels !== null ||
            timeline.videoOriginSeconds !== null ||
            timeline.audioOffsetMs !== null ||
            timeline.scannedStartMs !== null ||
            timeline.scannedEndMs !== null ||
            timeline.decodedFrameCount !== 0 ||
            value.cueCount !== 0 ||
            value.cues.length !== 0 ||
            value.associations.length !== 0 ||
            value.truncated)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 현재 처리 상태 및 원본 음향 표본 주파수의 조건에 따라 처리 분기
    if (
        value.status === "COMPLETE" &&
        (value.sourceSampleRateHz === null ||
            value.sourceChannels === null ||
            timeline.scannedStartMs === null ||
            timeline.scannedEndMs === null)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }

    // 이미 등록된 단서 식별자 보관 공간 생성
    const cueIds = new Set<string>();
    // 영상 또는 음향 단서 목록의 각 항목을 순서대로 검사
    for (const cue of value.cues) {
        // 음향 단서의 고유 식별자와 조사 구간 및 주파수·표본 수 확인
        if (
            !object(cue, ["id", "startMs", "endMs", "peakFrequenciesHz", "frameCount"]) ||
            typeof cue.id !== "string" ||
            cue.id.length === 0 ||
            cue.id.length > 96 ||
            cueIds.has(cue.id) ||
            !safe(cue.startMs) ||
            !safe(cue.endMs) ||
            cue.endMs > sourceDurationMs ||
            cue.endMs - cue.startMs < 200 ||
            !safe(cue.frameCount) ||
            cue.frameCount < 2 ||
            !Array.isArray(cue.peakFrequenciesHz) ||
            cue.peakFrequenciesHz.length < 2 ||
            cue.peakFrequenciesHz.length > 3 ||
            !cue.peakFrequenciesHz.every(
                (peak) => finite(peak) && peak >= 3_500 && peak <= 4_500
            ) ||
            (timeline.scannedStartMs !== null && cue.startMs < timeline.scannedStartMs) ||
            (timeline.scannedEndMs !== null && cue.endMs > timeline.scannedEndMs)
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 이미 등록된 단서 식별자 집합에 현재 항목 등록
        cueIds.add(cue.id);
    }
    // 단서와 후보 구간의 시간 연결 보관 공간 생성
    const associations = new Set<string>();
    // 단서와 후보 구간의 시간 연결의 각 항목을 순서대로 검사
    for (const association of value.associations) {
        // 단서와 후보 및 증거의 시간 연결 참조가 유효한지 확인
        if (
            !object(association, ["cueId", "candidateIndex", "evidenceIndices", "relation"]) ||
            typeof association.cueId !== "string" ||
            !cueIds.has(association.cueId) ||
            !safe(association.candidateIndex) ||
            association.relation !== "TEMPORAL_OVERLAP_ONLY" ||
            !Array.isArray(association.evidenceIndices) ||
            association.evidenceIndices.length < 1 ||
            association.evidenceIndices.length > 16 ||
            !association.evidenceIndices.every(safe) ||
            new Set(association.evidenceIndices).size !== association.evidenceIndices.length
        ) {
            // 필수 조건 불충족 결과 반환
            return false;
        }
        // 조회할 항목 키 계산
        const key = `${association.cueId}\u0000${association.candidateIndex}`;
        // 단서와 후보 구간의 시간 연결 및 조회할 항목 키의 조건에 따라 처리 분기
        if (associations.has(key)) return false;
        // 단서와 후보 구간의 시간 연결 집합에 현재 항목 등록
        associations.add(key);
    }
    // 모든 필수 조건 충족 결과 반환
    return true;
};
