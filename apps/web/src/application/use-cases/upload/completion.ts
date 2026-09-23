// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { UploadCompletionStore } from "../../ports/repositories/upload-store";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { CompletionStorage } from "../../ports/storage/upload-storage";
// 업로드와 보존 기간의 서비스 정책 가져옴
import type { UploadPolicy } from "./policy";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 업로드 완료 입력 계약 정의
export type CompletionInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 업로드 허가 기록의 식별자
    uploadIntentId: string;
}>;

// 업로드 완료 결과 정의
export type CompletionResult =
    | Readonly<{ kind: "COMPLETED"; videoAssetId: string }>
    | Readonly<{ kind: "UPLOAD_NOT_FOUND" }>
    | Readonly<{ kind: "UPLOAD_NOT_READY" }>
    | Readonly<{ kind: "UPLOAD_INVALID" }>
    | Readonly<{ kind: "UPLOAD_ALREADY_COMPLETED" }>
    | Readonly<{ kind: "INVALID_INPUT"; reason: "INVALID_ID" }>;

// 업로드 완료 의존 기능 계약 정의
export type CompletionDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 크기와 보존 기간 등의 서비스 정책
    policy: UploadPolicy;
    // 원본과 증거 파일을 다루는 저장소 기능
    storage: CompletionStorage;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: UploadCompletionStore;
}>;

// 업로드 완료 유스케이스
export const completion =
    ({ clock, policy, storage, repository }: CompletionDependencies) =>
    async (input: CompletionInput): Promise<CompletionResult> => {
        // 세션 식별자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 의도 식별자 정규화
        const uploadIntentId = input.uploadIntentId.toLowerCase();
        // 식별자 형식 확인
        if (!UUID_PATTERN.test(anonymousSessionId) || !UUID_PATTERN.test(uploadIntentId)) {
            // 업로드 완료 요청 식별자 오류 반환
            return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
        }

        // 현재 시각 조회
        const now = clock.now();
        // 완료 시각 계산
        const createdAt = now.toISOString();
        // 소유 의도 조회
        const intent = await repository.owned({ anonymousSessionId, uploadIntentId });
        // 의도 존재 확인
        if (!intent) {
            // 소유한 업로드 허가 기록 부재 반환
            return { kind: "UPLOAD_NOT_FOUND" };
        }
        // 의도 만료 확인
        if (new Date(intent.expiresAt).getTime() <= now.getTime()) {
            // 파일 전송을 완료할 준비가 되지 않은 결과 반환
            return { kind: "UPLOAD_NOT_READY" };
        }

        // 업로드 객체 확인
        const uploadedObject = await storage.head(intent.objectKey);
        // 업로드 객체 존재 확인
        if (!uploadedObject) {
            // 저장 파일이 아직 확인되지 않은 결과 반환
            return { kind: "UPLOAD_NOT_READY" };
        }
        // 업로드 객체 크기 확인
        if (
            uploadedObject.sizeBytes !== intent.expectedSizeBytes ||
            uploadedObject.sizeBytes > policy.maxBytes
        ) {
            // 신고 크기와 형식 조건을 위반한 파일 거부 반환
            return { kind: "UPLOAD_INVALID" };
        }

        // 검증 작업 만료 시각 계산
        const expiresAt = new Date(now.getTime() + policy.sourceTtlMs).toISOString();
        // 검증 작업 저장
        return repository.complete({
            // 업로드 허가 기록의 식별자
            uploadIntentId,
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 객체 저장소에서 파일을 찾는 경로
            objectKey: intent.objectKey,
            // 파일의 바이트 크기
            sizeBytes: uploadedObject.sizeBytes,
            // 파일 내용의 동일성을 대조하는 해시
            contentSha256: Uint8Array.from(uploadedObject.contentSha256),
            // 파일의 실제 또는 허용 콘텐츠 형식
            contentType: intent.declaredContentType,
            // 기록이 처음 생성된 시각
            createdAt,
            // 접근과 보존을 허용하는 만료 시각
            expiresAt,
            // 파일 보존과 허용 형식 정책의 버전
            mediaPolicyVersion: policy.mediaPolicyVersion,
            // 영상 검증 작업 입력 구조 버전
            validationJobPayloadVersion: policy.validationJobPayloadVersion,
            // 영상 검증 작업의 최대 시도 횟수
            validationMaxAttempts: policy.validationMaxAttempts
        });
    };
