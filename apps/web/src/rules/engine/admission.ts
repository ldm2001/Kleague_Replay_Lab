// 공통 관측과 판정 자료형 가져오기
import type {
    PerceptionModelComponent,
    PerceptionModelProvenance,
    PerceptionRun
} from "@replay/shared-types";
// 검출 모델의 고정 명세 가져오기
import detectorManifest from "../../../../../experiments/perception/src/replay_perception/model-manifest.json";
// 역할과 포즈 모델의 고정 명세 가져오기
import observerManifest from "../../../../../experiments/perception/src/replay_perception/observer-models.json";

// 서버에서 확인한 영상 근거 참조의 자료 구조 정의
export type VerifiedPerceptionReference = Readonly<{
    // 증거 목록에서의 순서
    evidenceIndex: number;
    // 기존 영상 후보의 순서
    candidateIndex: number;
    // 결과 종류
    kind?: "FRAME" | "CLIP";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 제출자가 기록한 파일 해시
    declaredContentSha256: string;
    // 서버가 직접 확인한 파일 해시
    verifiedContentSha256: string;
}>;

// 서버가 확인한 인식 승인 문맥의 자료 구조 정의
export type PerceptionAdmissionContext = Readonly<{
    // 서버에서 확인한 입력인지 여부
    serverVerified: boolean;
    // 영상 처리 파이프라인 버전
    pipelineVersion: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 비공개 원시 산출물 파일 정보
    artifact: Readonly<{ objectKey: string; contentSha256: string; sizeBytes: number }>;
    // 빠르게 조회할 근거 참조 목록
    references: readonly VerifiedPerceptionReference[];
    // 검증된 경기의 규정 판본
    ruleEdition: Readonly<{
        // 고유 식별자
        id: string;
        // 출처와 적용 정보의 검증 상태
        verificationStatus: string;
        // 검증 대상 경기 식별자
        matchId: string;
        // 국제 경기 규칙 판본
        ifabEdition: string;
    }> | null;
}>;

// 규정 사실 승인 여부와 차단 사유의 자료 구조 정의
export type PerceptionAdmission = Readonly<{
    // 현재 처리 상태
    status: "NOT_ADMITTED";
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}>;

// 고정 명세 파일에서 모델 파일 해시 조회
const fileHash = (
    files: readonly Readonly<{ name: string; sha256: string }>[],
    name: string
): string => {
    // 현재 검사할 파일 조회
    const file = files.find((item) => item.name === name);
    // 현재 검사할 파일의 조건에 따라 처리 분기
    if (!file) throw new Error(`Pinned model file is unavailable: ${name}`);
    // 현재 검사할 파일를 반영한 결과 반환
    return file.sha256;
};

// 서버 저장소의 고정 명세 파일만 신뢰하며 작업자가 보낸 승인 플래그는 입력으로 수신 제외
export const perceptionModelPins: Readonly<
    Record<PerceptionModelComponent, PerceptionModelProvenance>
> = Object.freeze({
    // 사람과 공의 검출 모델 기록
    detector: Object.freeze({
        // 검출·역할·포즈 중 해당 모델 기능 기록
        component: "detector",
        // 모델 출처 식별자 기록
        modelId: detectorManifest.model_id,
        // 고정한 모델 또는 자료의 개정 번호 기록
        revision: detectorManifest.revision,
        // 모델 가중치 파일의 고정 해시 기록
        weightsSha256: fileHash(detectorManifest.files, "model.safetensors")
    }),
    // 역할 검출 모델의 고정 출처와 가중치 해시
    role: Object.freeze({
        // 검출·역할·포즈 중 해당 모델 기능 기록
        component: "role",
        // 모델 출처 식별자 기록
        modelId: observerManifest.models.role.model_id,
        // 고정한 모델 또는 자료의 개정 번호 기록
        revision: observerManifest.models.role.revision,
        // 모델 가중치 파일의 고정 해시 기록
        weightsSha256: fileHash(
            observerManifest.models.role.files,
            "yolo-football-player-detection.pt"
        )
    }),
    // 관절 위치를 추정하는 모델 기록
    pose: Object.freeze({
        // 검출·역할·포즈 중 해당 모델 기능 기록
        component: "pose",
        // 모델 출처 식별자 기록
        modelId: observerManifest.models.pose.model_id,
        // 고정한 모델 또는 자료의 개정 번호 기록
        revision: observerManifest.models.pose.revision,
        // 모델 가중치 파일의 고정 해시 기록
        weightsSha256: fileHash(observerManifest.models.pose.files, "model.safetensors")
    })
});

// 규정 사실별 인식 방법의 자료 구조 정의
type RecognitionMethod = "role" | "signal" | "contact" | "foul" | "originalDecision" | "restart";
// 인식 방법의 검증 상태의 자료 구조 정의
type RecognitionMethodState = "VERIFIED" | "NOT_VERIFIED";

// 인식 방법별 운영 검증 상태 확인
export const perceptionRecognitionMethods: Readonly<
    Record<RecognitionMethod, RecognitionMethodState>
> = Object.freeze({
    // 인물 역할을 판별하는 방법의 미검증 상태
    role: "NOT_VERIFIED",
    // 심판 신호의 의미를 해석하는 방법의 미검증 상태
    signal: "NOT_VERIFIED",
    // 실제 접촉을 판별하는 방법의 미검증 상태
    contact: "NOT_VERIFIED",
    // 반칙 사실을 생성하는 방법의 미검증 상태
    foul: "NOT_VERIFIED",
    // 영상에서 원심을 판별하는 방법의 미검증 상태
    originalDecision: "NOT_VERIFIED",
    // 경기 재개를 판별하는 방법의 미검증 상태
    restart: "NOT_VERIFIED"
});

// 인식 방법별 승인 차단 사유 구성
const methodReasons = {
    // 역할 판별 방법 미검증으로 승인을 막는 사유
    role: "ROLE_METHOD_NOT_VERIFIED",
    // 신호 해석 방법 미검증으로 승인을 막는 사유
    signal: "SIGNAL_METHOD_NOT_VERIFIED",
    // 접촉 판별 방법 미검증으로 승인을 막는 사유
    contact: "CONTACT_METHOD_NOT_VERIFIED",
    // 반칙 사실 생성 방법 미검증으로 승인을 막는 사유
    foul: "FOUL_METHOD_NOT_VERIFIED",
    // 원심 판별 방법 미검증으로 승인을 막는 사유
    originalDecision: "ORIGINAL_DECISION_METHOD_NOT_VERIFIED",
    // 재개 판별 방법 미검증으로 승인을 막는 사유
    restart: "RESTART_METHOD_NOT_VERIFIED",
} as const;

// 고정 모델의 판본과 가중치 일치 확인
const sameModel = (
    actual: PerceptionModelProvenance,
    expected: PerceptionModelProvenance
): boolean =>
    actual.component === expected.component &&
    actual.modelId === expected.modelId &&
    actual.revision === expected.revision &&
    actual.weightsSha256 === expected.weightsSha256;

// 증거와 사건의 시간 중첩 확인
const relevant = (
    startMs: number,
    endMs: number,
    incidentStartMs: number,
    incidentEndMs: number
): boolean =>
    startMs === endMs
        ? startMs >= incidentStartMs && startMs <= incidentEndMs
        : startMs < incidentEndMs && endMs > incidentStartMs;

// 모델·원본·근거·규정의 승인 조건 확인
export const perceptionAdmission = (
    run: PerceptionRun,
    context: PerceptionAdmissionContext
): PerceptionAdmission => {
    // 확인 불가 또는 차단 사유 목록 초기화
    const reasons: string[] = [];
    // 서버 문맥 미검증에 해당하는 경우 사유 기록
    if (!context.serverVerified) reasons.push("SERVER_CONTEXT_UNVERIFIED");
    // 처리 방식과 자료 버전 불일치에 해당하는 경우 사유 기록
    if (
        (run.schemaVersion === "perception-run-v1" &&
            context.pipelineVersion !== "video-local-observers-v1") ||
        (run.schemaVersion === "perception-run-v2" &&
            context.pipelineVersion !== "video-local-observers-av-v1")
    ) {
        // 처리 방식과 자료 버전 불일치 사유 기록
        reasons.push("PIPELINE_VERSION_UNVERIFIED");
    }
    // 원본 표본 처리 미완료에 해당하는 경우 사유 기록
    if (run.processingStatus !== "COMPLETE") reasons.push("PROCESSING_NOT_COMPLETE");
    // 관측 요약 일부 누락에 해당하는 경우 사유 기록
    if (run.summary.truncated) reasons.push("SUMMARY_TRUNCATED");
    // 원본 내용 해시 미확인에 해당하는 경우 사유 기록
    if (context.sourceSha256 !== run.sourceSha256) reasons.push("SOURCE_HASH_UNVERIFIED");
    // 비공개 산출물 정보 불일치에 해당하는 경우 사유 기록
    if (
        context.artifact.objectKey !== run.artifact.objectKey ||
        context.artifact.contentSha256 !== run.artifact.contentSha256 ||
        context.artifact.sizeBytes !== run.artifact.sizeBytes
    ) {
        // 비공개 산출물 정보 불일치 사유 기록
        reasons.push("ARTIFACT_UNVERIFIED");
    }
    // 검출·역할·포즈 모델을 각각 고정 명세와 대조
    for (const component of ["detector", "role", "pose"] as const) {
        // 실제로 제출된 모델 정보 조회
        const actual = run.models.find((item) => item.component === component);
        // 실제로 제출된 모델 정보 및 검출·역할·포즈 중 해당 모델 기능의 조건에 따라 처리 분기
        if (!actual || !sameModel(actual, perceptionModelPins[component])) {
            // 현재 검사에서 확인한 승인 차단 사유 추가
            reasons.push(`MODEL_PROVENANCE_UNPINNED:${component}`);
        }
    }
    // 적용 규정 판본 미검증에 해당하는 경우 사유 기록
    if (
        !context.ruleEdition ||
        context.ruleEdition.verificationStatus !== "VERIFIED" ||
        typeof context.ruleEdition.matchId !== "string" ||
        context.ruleEdition.matchId.length === 0 ||
        typeof context.ruleEdition.ifabEdition !== "string" ||
        context.ruleEdition.ifabEdition.length === 0
    ) {
        // 적용 규정 판본 미검증 사유 기록
        reasons.push("RULE_EDITION_UNVERIFIED");
    }

    // 빠르게 조회할 근거 참조 목록 보관 공간 생성
    const references = new Map(context.references.map((item) => [item.evidenceIndex, item]));
    // 인식 사건 목록의 각 항목을 순서대로 검사
    for (const incident of run.incidents) {
        // 원본 기준 시작 시각 및 원본 기준 종료 시각의 조건에 따라 처리 분기
        if (incident.startMs < run.coverage.startMs || incident.endMs > run.coverage.endMs) {
            // 현재 검사에서 확인한 승인 차단 사유 추가
            reasons.push(`RUN_COVERAGE_INSUFFICIENT:${incident.id}`);
        }
        // 사건을 포함하는 근거 확인 여부 초기화
        let covered = false;
        // 기존 보고서의 증거 순서 목록의 각 항목을 순서대로 검사
        for (const index of incident.evidenceIndices) {
            // 현재 검사할 증거 참조 조회
            const reference = references.get(index);
            // 현재 검사할 증거 참조의 조건에 따라 처리 분기
            if (!reference) {
                // 현재 검사에서 확인한 승인 차단 사유 추가
                reasons.push(`REFERENCE_MISSING:${index}`);
                // 현재 항목은 제외하고 다음 항목 검사
                continue;
            }
            // 기존 영상 후보의 순서의 조건에 따라 처리 분기
            if (reference.candidateIndex !== incident.candidateIndex) {
                // 현재 검사에서 확인한 승인 차단 사유 추가
                reasons.push(`REFERENCE_CANDIDATE_MISMATCH:${index}`);
            }
            // 제출자가 기록한 파일 해시 및 서버가 직접 확인한 파일 해시의 조건에 따라 처리 분기
            if (reference.declaredContentSha256 !== reference.verifiedContentSha256) {
                // 현재 검사에서 확인한 승인 차단 사유 추가
                reasons.push(`REFERENCE_HASH_UNVERIFIED:${index}`);
            }
            // 기존 영상 후보의 순서 및 원본 기준 시작 시각의 조건에 따라 처리 분기
            if (
                reference.candidateIndex === incident.candidateIndex &&
                relevant(reference.startMs, reference.endMs, incident.startMs, incident.endMs)
            ) {
                // 사건을 포함하는 근거 확인 여부 갱신
                covered = true;
            }
        }
        // 사건을 포함하는 근거 확인 여부의 조건에 따라 처리 분기
        if (!covered) reasons.push(`REFERENCE_COVERAGE_INSUFFICIENT:${incident.id}`);
        // 심판 역할에 대한 가설의 조건에 따라 처리 분기
        if (incident.officialRole === "UNKNOWN")
            // 현재 검사에서 확인한 승인 차단 사유 추가
            reasons.push(`OFFICIAL_ROLE_UNKNOWN:${incident.id}`);
        // 심판 신호의 시각적 형태의 조건에 따라 처리 분기
        if (incident.signal === "UNKNOWN") reasons.push(`SIGNAL_UNKNOWN:${incident.id}`);
    }

    // 전송 자료의 구조 버전의 조건에 따라 처리 분기
    if (run.schemaVersion === "perception-run-v2") {
        // 발견한 원시 단서 수의 조건에 따라 처리 분기
        if (run.audio.cueCount > 0) reasons.push("AUDIO_CUE_METHOD_NOT_VERIFIED");
        // 단서와 후보 구간의 시간 연결의 조건에 따라 처리 분기
        if (run.audio.associations.length > 0) reasons.push("AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED");
        // 현재 검사에서 확인한 승인 차단 사유 추가
        reasons.push("SPEECH_NOT_ANALYZED");
    }

    // 닫힌 서버 승인 목록: 저장 무결성은 영상 의미의 검증이나 규정 사실 승인이 아님
    for (const method of Object.keys(perceptionRecognitionMethods) as RecognitionMethod[]) {
        // 인식 방법별 운영 검증 상태 및 관측 또는 검사 방법의 조건에 따라 처리 분기
        if (perceptionRecognitionMethods[method] !== "VERIFIED")
            // 현재 검사에서 확인한 승인 차단 사유 추가
            reasons.push(methodReasons[method]);
    }
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return { status: "NOT_ADMITTED", reasons: [...new Set(reasons)] };
};
