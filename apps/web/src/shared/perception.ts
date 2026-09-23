// 승인된 모델의 기능 구분의 자료 구조 정의
export type PerceptionModelComponent = "detector" | "role" | "pose";

// 모델의 고정 출처와 해시의 자료 구조 정의
export type PerceptionModelProvenance = Readonly<{
    // 검출·역할·포즈 중 해당 모델 기능
    component: PerceptionModelComponent;
    // 모델 출처 식별자
    modelId: string;
    // 고정한 모델 또는 자료의 개정 번호
    revision: string;
    // 모델 가중치 파일의 고정 해시
    weightsSha256: string;
}>;

// 인식 사건의 비공개 요약의 자료 구조 정의
export type PerceptionIncident = Readonly<{
    // 고유 식별자
    id: string;
    // 기존 영상 후보의 순서
    candidateIndex: number;
    // 추적이 이어지는 구간 식별자
    continuityId: number;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 기존 보고서의 증거 순서 목록
    evidenceIndices: readonly number[];
    // 심판 역할에 대한 가설
    officialRole: "MAIN_CANDIDATE" | "ASSISTANT_CANDIDATE" | "UNKNOWN";
    // 심판 신호의 시각적 형태
    signal: "RAISED_ARM" | "FLAG_LIKE" | "YELLOW_CARD_LIKE" | "RED_CARD_LIKE" | "UNKNOWN";
    // 접촉 관측의 확인 상태
    contact: "UNVERIFIED";
    // 영상에서 관측한 실제 주심 판정
    originalDecision: "UNKNOWN";
    // 경기 재개에 관한 결과
    restart: "UNVERIFIED";
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}>;

// 음향 관측 계약 가져오기
import { audioObservationsData, type AudioObservations } from "./audio-observations";

// 시각 인식 실행 계약의 자료 구조 정의
export type PerceptionRunV1 = Readonly<{
    // 전송 자료의 구조 버전
    schemaVersion: "perception-run-v1";
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 표본 처리 상태이며 반칙 판정 완료와 구분
    processingStatus: "COMPLETE" | "PARTIAL";
    // 원본에서 실제로 처리한 시간 범위
    coverage: Readonly<{
        // 원본 기준 시작 시각
        startMs: number;
        // 원본 기준 종료 시각
        endMs: number;
        // 표본 사이의 원본 시간 간격
        sampleIntervalMs: number;
        // 처리할 것으로 예상한 표본 수
        expectedSamples: number;
        // 실제로 처리한 표본 수
        processedSamples: number;
        // 처리에 실패한 표본 수
        failedSamples: number;
    }>;
    // 사용한 모델의 고정 출처 목록
    models: readonly PerceptionModelProvenance[];
    // 비공개 원시 산출물 파일 정보
    artifact: Readonly<{
        // 저장소 내부 파일 키
        objectKey: string;
        // 파일 형식
        contentType: "application/gzip";
        // 파일 내용의 해시
        contentSha256: string;
        // 파일의 바이트 크기
        sizeBytes: number;
    }>;
    // 전체 관측의 집계 결과
    summary: Readonly<{
        // 역할 관측 수
        roleObservationCount: number;
        // 관절 관측 수
        poseObservationCount: number;
        // 심판 관련 영상 단서 수
        officialCueCount: number;
        // 일반 상호작용 후보 수
        interactionCount: number;
        // 관측 사이의 연결 후보 수
        linkCount: number;
        // 전체 항목 중 일부만 보존됐는지 여부
        truncated: boolean;
        // 확인 불가 또는 차단 사유 목록
        reasons: readonly string[];
    }>;
    // 인식 사건 목록
    incidents: readonly PerceptionIncident[];
}>;

// 시각과 음향을 함께 보존하는 인식 계약의 자료 구조 정의
export type PerceptionRunV2 = Omit<PerceptionRunV1, "schemaVersion"> & Readonly<{
    // 전송 자료의 구조 버전
    schemaVersion: "perception-run-v2";
    // 시각 관측과 분리된 음향 관측
    audio: AudioObservations;
}>;

// 영상 인식 실행 계약의 자료 구조 정의
export type PerceptionRun = PerceptionRunV1 | PerceptionRunV2;

// 인식과 연결할 후보 구간의 자료 구조 정의
export type PerceptionCandidateReference = Readonly<{
    // 목록 순서
    index: number;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
}>;

// 인식과 연결할 증거 구간의 자료 구조 정의
export type PerceptionEvidenceReference = Readonly<{
    // 기존 영상 후보의 순서
    candidateIndex: number;
    // 결과 종류
    kind?: "FRAME" | "CLIP";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
}>;

// 파일 해시의 허용 형식 정의
const SHA256 = /^[a-f0-9]{64}$/;
// 고유 식별자의 허용 형식 정의
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
// 작업별 비공개 파일 키의 허용 형식 정의
const ARTIFACT_KEY = new RegExp(
    `^perception/${UUID}/${UUID}/[1-9][0-9]*/([a-f0-9]{64})\\.jsonl\\.gz$`
);
// 인식 실행 자료의 최대 크기 제한
const MAX_RUN_BYTES = 256 * 1_024;
// 비공개 압축 파일의 최대 크기 제한
const MAX_ARTIFACT_BYTES = 128 * 1_024 * 1_024;
// 요약에 포함할 최대 사건 수 제한
const MAX_INCIDENTS = 128;
// 사유 목록의 최대 항목 수 제한
const MAX_REASONS = 32;
// 증거 참조의 최대 항목 수 제한
const MAX_REFERENCES = 16;

// 객체 형식 확인
const object = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
    // 일반 객체가 아닌 값과 배열 입력 거절
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    // 객체에 실제로 존재하는 필드 이름 목록 추출
    const actual = Object.keys(value);
    // 누락되거나 추가된 필드 없이 필수 필드가 정확히 있는지 반환
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

// 안전한 비음수 정수 확인
const safe = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// 문자열 길이 제한 확인
const boundedText = (value: unknown, maximum: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= maximum;

// 제한된 길이의 사유 목록 확인
const reasons = (value: unknown): value is readonly string[] =>
    Array.isArray(value) &&
    value.length <= MAX_REASONS &&
    value.every((item) => boundedText(item, 128));

// 인식 처리 구간과 샘플 수 확인
const coverageData = (value: unknown): boolean => {
    // 처리 구간과 표본 수를 나타내는 필수 필드 확인
    if (
        !object(value, [
            "startMs",
            "endMs",
            "sampleIntervalMs",
            "expectedSamples",
            "processedSamples",
            "failedSamples"
        ])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 원본 기준 시작 시각 및 원본 기준 종료 시각의 조건에 따라 처리 분기
    if (
        !safe(value.startMs) ||
        !safe(value.endMs) ||
        value.endMs <= value.startMs ||
        !safe(value.sampleIntervalMs) ||
        value.sampleIntervalMs === 0 ||
        !safe(value.expectedSamples) ||
        !safe(value.processedSamples) ||
        !safe(value.failedSamples)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 처리 구간의 길이 계산
    const spanMs = value.endMs - value.startMs;
    // 구간과 간격으로 계산한 예상 표본 수 확인
    const calculatedSamples = Math.ceil(spanMs / value.sampleIntervalMs);
    // 성공과 실패를 합한 처리 표본 수 계산
    const completedSamples = value.processedSamples + value.failedSamples;
    // 예상 표본 수가 시간 간격 계산과 맞고 처리 수가 이를 넘지 않는지 반환
    return (
        safe(spanMs) &&
        spanMs > 0 &&
        safe(calculatedSamples) &&
        calculatedSamples > 0 &&
        value.expectedSamples === calculatedSamples &&
        safe(completedSamples) &&
        completedSamples <= value.expectedSamples
    );
};

// 모델 출처와 가중치 해시 형식 확인
const modelData = (value: unknown): value is PerceptionModelProvenance => {
    // 모델 구성요소와 출처 및 가중치 해시 필드 확인
    if (!object(value, ["component", "modelId", "revision", "weightsSha256"])) return false;
    // 허용된 모델 기능과 출처 문자열 및 해시 형식 확인 결과 반환
    return ["detector", "role", "pose"].includes(value.component as string) &&
        boundedText(value.modelId, 160) && boundedText(value.revision, 64) &&
        typeof value.weightsSha256 === "string" && SHA256.test(value.weightsSha256);
};

// 인식 파일의 키·크기·해시 형식 확인
const artifactData = (value: unknown): boolean => {
    // 저장소 키와 파일 형식 및 내용 해시와 크기 필드 확인
    if (!object(value, ["objectKey", "contentType", "contentSha256", "sizeBytes"])) return false;
    // 압축 형식과 파일 키 및 해시 형식과 크기 제한 확인
    if (typeof value.objectKey !== "string" || typeof value.contentSha256 !== "string" ||
        !SHA256.test(value.contentSha256) || value.contentType !== "application/gzip" ||
        !safe(value.sizeBytes) || value.sizeBytes === 0 || value.sizeBytes > MAX_ARTIFACT_BYTES) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 비공개 파일 키에 포함된 해시 부분 추출
    const match = ARTIFACT_KEY.exec(value.objectKey);
    // 파일 키 안의 해시와 제출한 내용 해시의 일치 여부 반환
    return match?.[1] === value.contentSha256;
};

// 인식 집계와 누락 사유 형식 확인
const summaryData = (value: unknown): boolean => {
    // 관측 수량과 요약 생략 여부 및 사유 필드 확인
    if (!object(value, [
        "roleObservationCount", "poseObservationCount", "officialCueCount", "interactionCount",
        "linkCount", "truncated", "reasons",
    ])) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 관측 수량의 유효 범위와 생략 상태 및 사유 목록 확인 결과 반환
    return safe(value.roleObservationCount) && safe(value.poseObservationCount) &&
        safe(value.officialCueCount) && safe(value.interactionCount) && safe(value.linkCount) &&
        typeof value.truncated === "boolean" && reasons(value.reasons);
};

// 인식 사건의 구간·참조·미확인 상태 확인
const incidentData = (value: unknown): value is PerceptionIncident => {
    // 사건 구간과 후보 연결 및 관측 상태의 필수 필드 확인
    if (
        !object(value, [
            "id",
            "candidateIndex",
            "continuityId",
            "startMs",
            "endMs",
            "evidenceIndices",
            "officialRole",
            "signal",
            "contact",
            "originalDecision",
            "restart",
            "reasons"
        ])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 식별자와 시간 범위 및 중복 없는 증거 순서 목록 확인
    if (
        !boundedText(value.id, 128) ||
        !safe(value.candidateIndex) ||
        !safe(value.continuityId) ||
        !safe(value.startMs) ||
        !safe(value.endMs) ||
        value.endMs <= value.startMs ||
        !Array.isArray(value.evidenceIndices) ||
        value.evidenceIndices.length > MAX_REFERENCES ||
        !value.evidenceIndices.every(safe) ||
        new Set(value.evidenceIndices).size !== value.evidenceIndices.length
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 허용된 시각 단서만 보존하고 접촉·원심·재개는 미확인 상태로 제한
    return (
        ["MAIN_CANDIDATE", "ASSISTANT_CANDIDATE", "UNKNOWN"].includes(
            value.officialRole as string
        ) &&
        ["RAISED_ARM", "FLAG_LIKE", "YELLOW_CARD_LIKE", "RED_CARD_LIKE", "UNKNOWN"].includes(
            value.signal as string
        ) &&
        value.contact === "UNVERIFIED" &&
        value.originalDecision === "UNKNOWN" &&
        value.restart === "UNVERIFIED" &&
        reasons(value.reasons)
    );
};

// 크기 처리
const jsonSize = (value: unknown): number | null => {
    // 자료 처리 오류를 별도 실패 결과로 구분하기 위한 실행 구간
    try {
        // 검사 대상의 직렬화 문자열 확인
        const serialized = JSON.stringify(value);
        // 조건에 맞는 결과와 대체 결과 중 하나를 선택해 반환
        return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
    } catch {
        // 확인 가능한 결과가 없어 빈 값 반환
        return null;
    }
};

// 인식 실행 계약과 처리 완결성 확인
export const perceptionRunData = (value: unknown): value is PerceptionRun => {
    // 직렬화한 자료의 크기 확인
    const size = jsonSize(value);
    // 직렬화할 수 없는 값과 크기 초과 및 일반 객체가 아닌 입력 거절
    if (
        size === null ||
        size > MAX_RUN_BYTES ||
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 확인할 버전 참조
    const version = (value as Record<string, unknown>).schemaVersion;
    // 확인할 버전의 조건에 따라 처리 분기
    if (version !== "perception-run-v1" && version !== "perception-run-v2") return false;
    // 값 및 확인할 버전의 조건에 따라 처리 분기
    if (
        !object(value, [
            "schemaVersion",
            "sourceSha256",
            "processingStatus",
            "coverage",
            "models",
            "artifact",
            "summary",
            "incidents",
            ...(version === "perception-run-v2" ? ["audio"] : [])
        ])
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 원본 해시와 처리 구간 및 모델·산출물·요약·사건 자료 구조 확인
    if (
        typeof value.sourceSha256 !== "string" ||
        !SHA256.test(value.sourceSha256) ||
        !["COMPLETE", "PARTIAL"].includes(value.processingStatus as string) ||
        !coverageData(value.coverage) ||
        !Array.isArray(value.models) ||
        value.models.length !== 3 ||
        !value.models.every(modelData) ||
        !artifactData(value.artifact) ||
        !summaryData(value.summary) ||
        !Array.isArray(value.incidents) ||
        value.incidents.length > MAX_INCIDENTS ||
        !value.incidents.every(incidentData)
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 확인할 버전 및 시각 관측과 분리된 음향 관측의 조건에 따라 처리 분기
    if (
        version === "perception-run-v2" &&
        !audioObservationsData(
            value.audio,
            value.sourceSha256,
            (value.coverage as { endMs: number }).endMs
        )
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 영상 인식 실행 결과 계산
    const run = value as unknown as PerceptionRun;
    // 모델 구성요소 목록 보관 공간 생성
    const components = new Set(run.models.map((item) => item.component));
    // 직렬화한 자료의 크기 및 현재 처리 항목의 조건에 따라 처리 분기
    if (
        components.size !== 3 ||
        !["detector", "role", "pose"].every((item) =>
            components.has(item as PerceptionModelComponent)
        )
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 직렬화한 자료의 크기 및 인식 사건 목록의 조건에 따라 처리 분기
    if (new Set(run.incidents.map((item) => item.id)).size !== run.incidents.length) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 완료 상태는 모든 표본 처리와 실패 없음 및 음향 처리 충족 여부로 확인
    return (
        run.processingStatus !== "COMPLETE" ||
        (run.coverage.processedSamples === run.coverage.expectedSamples &&
            run.coverage.failedSamples === 0 &&
            (run.schemaVersion === "perception-run-v1" ||
                ["COMPLETE", "ABSENT"].includes(run.audio.status)))
    );
};

// 인식 근거 참조 확인
export const perceptionRefs = (
    run: PerceptionRun,
    candidates: readonly PerceptionCandidateReference[],
    evidence: readonly PerceptionEvidenceReference[]
): boolean => {
    // 순서로 조회할 후보 목록 보관 공간 생성
    const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
    // 직렬화한 자료의 크기의 조건에 따라 처리 분기
    if (byIndex.size !== candidates.length) return false;
    // 인식 사건 목록의 각 항목을 순서대로 검사
    for (const incident of run.incidents) {
        // 현재 영상 후보 조회
        const candidate = byIndex.get(incident.candidateIndex);
        // 현재 영상 후보 및 원본 기준 시작 시각의 조건에 따라 처리 분기
        if (!candidate || incident.startMs < candidate.startMs || incident.endMs > candidate.endMs)
            // 필수 조건 불충족 결과 반환
            return false;
        // 기존 보고서의 증거 순서 목록의 각 항목을 순서대로 검사
        for (const index of incident.evidenceIndices) {
            // 순번에 해당하는 실제 증거 참조 조회
            const item = evidence[index];
            // 현재 처리 항목 및 기존 영상 후보의 순서의 조건에 따라 처리 분기
            if (
                !item ||
                item.candidateIndex !== incident.candidateIndex ||
                item.startMs < candidate.startMs ||
                item.endMs > candidate.endMs
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
        }
    }
    // 전송 자료의 구조 버전의 조건에 따라 처리 분기
    if (run.schemaVersion === "perception-run-v2") {
        // 단서와 후보 구간의 시간 연결의 각 항목을 순서대로 검사
        for (const association of run.audio.associations) {
            // 현재 검토할 단서 조회
            const cue = run.audio.cues.find((item) => item.id === association.cueId);
            // 현재 영상 후보 조회
            const candidate = byIndex.get(association.candidateIndex);
            // 현재 검토할 단서 및 현재 영상 후보의 조건에 따라 처리 분기
            if (
                !cue ||
                !candidate ||
                association.evidenceIndices.length === 0 ||
                cue.startMs < candidate.startMs ||
                cue.endMs > candidate.endMs
            ) {
                // 필수 조건 불충족 결과 반환
                return false;
            }
            // 기존 보고서의 증거 순서 목록의 각 항목을 순서대로 검사
            for (const index of association.evidenceIndices) {
                // 순번에 해당하는 실제 증거 참조 조회
                const item = evidence[index];
                // 현재 처리 항목 및 결과 종류의 조건에 따라 처리 분기
                if (
                    !item ||
                    item.kind !== "CLIP" ||
                    item.candidateIndex !== association.candidateIndex ||
                    item.startMs > cue.startMs ||
                    item.endMs < cue.endMs ||
                    item.startMs < candidate.startMs ||
                    item.endMs > candidate.endMs
                ) {
                    // 필수 조건 불충족 결과 반환
                    return false;
                }
            }
        }
    }
    // 모든 필수 조건 충족 결과 반환
    return true;
};
