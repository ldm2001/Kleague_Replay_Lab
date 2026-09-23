// 객체 검증 입력과 사전 검사 계약 가져옴
import type { AnalysisPayload, JobResultPreflight } from "../../ports/repositories/job-store";
// 실제 객체 저장소 읽기 계약 가져옴
import type { CompletionStorage } from "../../ports/storage/upload-storage";

// 바이트 배열을 16진 문자열로 변환
export const bytesHex = (value: Uint8Array): string =>
    Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

// 해시 일치 확인
export const verifiedHash = (value: Uint8Array, expected: string): boolean =>
    value.length === 32 && bytesHex(value) === expected;

// 비공개 관측 원문 검증의 파일 크기 상한 지정
const MAX_PERCEPTION_OBJECT_BYTES = 128 * 1_024 * 1_024;
// 참조 증거 검증의 파일 크기 상한 지정
const MAX_REFERENCE_OBJECT_BYTES = 50 * 1_024 * 1_024;

// 원본 권한 확인을 마친 문맥 계약 정의
export type Context = Extract<JobResultPreflight, { kind: "AUTHORIZED" }>;

// 실제 객체 읽기의 예외만 기존 저장소 거부 결과로 변환
const head = async (storage: CompletionStorage, key: string, limit: number) => {
    // 외부 저장소 호출에만 예외 경계 설정
    try {
        // 파일 읽기 결과와 검증 상태 반환
        return { kind: "READ", object: await storage.head(key, limit) } as const;
    } catch {
        // 실제 저장소 읽기 실패 반환
        return { kind: "INVALID_RESULT", reason: "STORAGE" } as const;
    }
};

// 관측 원문과 화면 및 음향 참조 파일의 실제 해시 확인
export const objects = async (
    input: AnalysisPayload,
    preflight: Context,
    jobId: string,
    storage: CompletionStorage
) => {
    // 입력 검사를 마친 관측 자료 읽음
    const perception = input.perception!;
    // 허용 크기 안에서 비공개 관측 원문의 크기와 해시 조회
    const artifactRead = await head(
        storage,
        perception.artifact.objectKey,
        MAX_PERCEPTION_OBJECT_BYTES
    );
    // 파일 읽기 예외의 기존 거부 계약 유지
    if (artifactRead.kind === "INVALID_RESULT") return artifactRead;
    // 실제 저장 파일 메타데이터 읽음
    const artifact = artifactRead.object;
    // 저장된 비공개 관측 파일의 실제 크기와 내용 해시 대조
    if (
        !artifact ||
        artifact.sizeBytes !== perception.artifact.sizeBytes ||
        !verifiedHash(artifact.contentSha256, perception.artifact.contentSha256)
    ) {
        // 제출한 비공개 관측 원문 검증 실패 반환
        return { kind: "INVALID_RESULT", reason: "ARTIFACT" } as const;
    }
    // 제출된 증거 목록을 읽고 없으면 빈 목록 사용
    const evidence = input.evidence ?? [];
    // 시청각 자료에서 시간 연결이 참조한 증거 순번 추출
    const audioIndices =
        perception.schemaVersion === "perception-run-v2"
            ? perception.audio.associations.flatMap(
                (association) => association.evidenceIndices
            )
            : [];
    // 인식 사건과 음향 연결의 증거 순번을 중복 없이 통합
    const indices = [
        ...new Set([
            ...perception.incidents.flatMap((incident) => incident.evidenceIndices),
            ...audioIndices
        ])
    ];
    // 참조한 각 증거 파일의 실제 해시를 병렬 확인한 목록 생성
    const references = await Promise.all(
        indices.map(async (evidenceIndex) => {
            // 참조 순번에 해당하는 제출 증거 항목 읽음
            const item = evidence[evidenceIndex]!;
            // 다른 작업의 증거를 참조하지 못하도록 허용 경로 생성
            const expectedPrefix = `evidence/${preflight.analysisId}/${jobId.toLowerCase()}/`;
            // 다른 분석이나 작업의 증거 파일 참조 차단
            if (!item.objectKey.startsWith(expectedPrefix)) return null;
            // 저장된 증거 파일의 실제 크기와 내용 해시 조회
            const objectRead = await head(
                storage,
                item.objectKey,
                MAX_REFERENCE_OBJECT_BYTES
            );
            // 증거 파일 읽기 실패를 별도 거부 값으로 반환
            if (objectRead.kind === "INVALID_RESULT") return objectRead;
            // 실제 증거 파일 메타데이터 읽음
            const object = objectRead.object;
            // 실제 저장 증거의 존재와 신고 해시 일치 확인
            if (!object || !verifiedHash(object.contentSha256, item.contentSha256)) {
                // 파일을 확인할 수 없는 증거 참조를 빈 값으로 반환
                return null;
            }
            // 신고 해시와 서버 검증 해시를 분리한 증거 참조 반환
            return {
                // 제출 목록에서 증거를 찾는 순번
                evidenceIndex,
                // 처리 결과에서 후보 장면을 찾는 순번
                candidateIndex: item.candidateIndex,
                // 처리 분기 또는 자료 종류를 구별하는 값
                kind: item.kind,
                // 원본 영상 기준 구간 시작 밀리초
                startMs: item.startMs,
                // 원본 영상 기준 구간 종료 밀리초
                endMs: item.endMs,
                // 제출자가 신고한 파일 내용 해시
                declaredContentSha256: item.contentSha256.toLowerCase(),
                // 서버가 저장 파일에서 확인한 내용 해시
                verifiedContentSha256: bytesHex(object.contentSha256)
            };
        })
    );
    // 증거 읽기 실패를 누락 참조보다 먼저 구분
    if (references.some((reference) => reference !== null && "reason" in reference)) {
        // 실제 저장소 읽기 예외의 거부 결과 반환
        return { kind: "INVALID_RESULT", reason: "STORAGE" } as const;
    }
    // 참조한 증거 중 하나라도 검증에 실패했는지 확인
    if (references.some((reference) => reference === null)) {
        // 확인하지 못한 참조 증거가 있는 결과 거부 반환
        return { kind: "INVALID_RESULT", reason: "REFERENCE" } as const;
    }
    // 실제 검증에 성공한 원문과 증거 참조 반환
    return {
        kind: "VERIFIED",
        artifact,
        references: references.filter(
            (reference): reference is Exclude<typeof reference, null | { kind: "INVALID_RESULT" }> =>
                reference !== null && !("reason" in reference)
        )
    } as const;
};
