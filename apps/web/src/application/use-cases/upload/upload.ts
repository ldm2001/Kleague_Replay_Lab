// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { UploadIntentStore } from "../../ports/repositories/upload-store";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { UploadStorage } from "../../ports/storage/upload-storage";
// 업로드와 보존 기간의 서비스 정책 가져옴
import type { UploadPolicy } from "./policy";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 내부 계약에서 허용하는 대회 이름 집합 생성
const COMPETITIONS = new Set(["K리그1", "K리그2"]);
// 내부 계약에서 허용하는 시즌 집합 생성
const SEASONS = new Set(["2026"]);

// 업로드 입력 계약 정의
export type UploadInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 업로드 전에 신고한 파일 바이트 크기
    expectedSizeBytes: number;
    // 업로드 전에 신고한 콘텐츠 형식
    declaredContentType: string;
    // 영상 사용 권리 확인 여부
    rightsConfirmed: boolean;
    // 규정 적용 대상 대회
    competition?: string;
    // 규정 적용 대상 시즌
    season?: string;
}>;

// 업로드 결과 정의
export type UploadResult =
    | Readonly<{
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "CREATED";
            // 업로드 허가 기록의 식별자
            uploadIntentId: string;
            // 객체 저장소에서 파일을 찾는 경로
            objectKey: string;
            // 파일을 직접 전송할 기한부 서명 주소
            uploadUrl: string;
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: string;
        }>
    | Readonly<{ kind: "INVALID_INPUT"; reason: "INVALID_ID" | "INVALID_SIZE" | "COMPETITION" }>
    | Readonly<{ kind: "INVALID_SIZE" }>
    | Readonly<{ kind: "UNSUPPORTED_CONTENT_TYPE" }>
    | Readonly<{ kind: "RIGHTS_NOT_CONFIRMED" }>
    | Readonly<{ kind: "SESSION_UNAVAILABLE" }>;

// 업로드 의존 기능 계약 정의
export type UploadDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 크기와 보존 기간 등의 서비스 정책
    policy: UploadPolicy;
    // 원본과 증거 파일을 다루는 저장소 기능
    storage: UploadStorage;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: UploadIntentStore;
}>;

// 업로드 생성 유스케이스
export const upload =
    ({ clock, policy, storage, repository }: UploadDependencies) =>
    async (input: UploadInput): Promise<UploadResult> => {
        // 세션 식별자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 세션 식별자 확인
        if (!UUID_PATTERN.test(anonymousSessionId)) {
            // 익명 세션 식별자 오류 반환
            return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
        }

        // 대회와 시즌 기본값 적용
        const competition = input.competition?.trim() || "UNKNOWN";
        // 시즌 미입력을 추정값 대신 미확정 상태로 보존
        const season = input.season?.trim() || "UNKNOWN";
        // 대회와 시즌 허용값 확인
        if (
            (competition !== "UNKNOWN" || season !== "UNKNOWN") &&
            (!COMPETITIONS.has(competition) || !SEASONS.has(season))
        ) {
            // 내부 계약에서 허용하지 않는 대회 시즌 조합 오류 반환
            return { kind: "INVALID_INPUT", reason: "COMPETITION" };
        }

        // 업로드 크기 형식 확인
        if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
            // 양의 안전한 정수가 아닌 업로드 크기 오류 반환
            return { kind: "INVALID_INPUT", reason: "INVALID_SIZE" };
        }

        // 업로드 크기 제한 확인
        if (input.expectedSizeBytes > policy.maxBytes) {
            // 업로드 정책의 크기 상한 초과 반환
            return { kind: "INVALID_SIZE" };
        }

        // 콘텐츠 형식 확인
        if (!policy.allowedContentTypes.includes(input.declaredContentType)) {
            // 허용하지 않는 영상 콘텐츠 형식 반환
            return { kind: "UNSUPPORTED_CONTENT_TYPE" };
        }

        // 권리 확인 상태 확인
        if (!input.rightsConfirmed) {
            // 영상 사용 권리 미확인 결과 반환
            return { kind: "RIGHTS_NOT_CONFIRMED" };
        }

        // 현재 시각 조회
        const now = clock.now();
        // 의도 생성 시각 계산
        const createdAt = now.toISOString();
        // 의도 만료 시각 계산
        const expiresAt = new Date(now.getTime() + policy.uploadIntentTtlMs).toISOString();
        // 저장소 업로드 권한 발급
        const grant = await storage.grant({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 업로드 전에 신고한 파일 바이트 크기
            expectedSizeBytes: input.expectedSizeBytes,
            // 파일의 실제 또는 허용 콘텐츠 형식
            contentType: input.declaredContentType,
            // 접근과 보존을 허용하는 만료 시각
            expiresAt
        });
        // 업로드 의도 저장
        let persisted: Awaited<ReturnType<UploadIntentStore["intent"]>>;
        // 허가 기록 저장 실패 시 발급 파일을 정리할 예외 경계 설정
        try {
            // 발급한 파일 경로와 신고 크기 및 정책을 업로드 허가로 저장
            persisted = await repository.intent({
                // 업로드 소유자를 구별하는 익명 세션 식별자
                anonymousSessionId,
                // 객체 저장소에서 파일을 찾는 경로
                objectKey: grant.objectKey,
                // 업로드 전에 신고한 파일 바이트 크기
                expectedSizeBytes: input.expectedSizeBytes,
                // 업로드 전에 신고한 콘텐츠 형식
                declaredContentType: input.declaredContentType,
                // 규정 적용 대상 대회
                competition,
                // 규정 적용 대상 시즌
                season,
                // 영상 사용 권리를 확인한 시각
                rightsConfirmedAt: createdAt,
                // 접근과 보존을 허용하는 만료 시각
                expiresAt,
                // 파일 보존과 허용 형식 정책의 버전
                mediaPolicyVersion: policy.mediaPolicyVersion
            });
        } catch (error) {
            // 저장 오류 보상 삭제
            await storage.cleanup(grant.objectKey);
            // 보상 정리 후 원래 저장 오류를 상위로 전달
            throw error;
        }

        // 업로드 의도 저장 결과 확인
        if (persisted.kind !== "CREATED") {
            // 저장 실패 보상 삭제
            await storage.cleanup(grant.objectKey);
            // 세션 등의 조건으로 허가 저장이 거부된 결과 반환
            return persisted;
        }

        // 업로드 결과 반환
        return {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "CREATED",
            // 업로드 허가 기록의 식별자
            uploadIntentId: persisted.uploadIntentId,
            // 객체 저장소에서 파일을 찾는 경로
            objectKey: grant.objectKey,
            // 파일을 직접 전송할 기한부 서명 주소
            uploadUrl: grant.uploadUrl,
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: grant.expiresAt
        };
    };
