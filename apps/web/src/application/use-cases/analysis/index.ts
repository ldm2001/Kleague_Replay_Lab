// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 영상 분석의 요청과 저장 계약 가져옴
import type {
    AnalysisCommand,
    AnalysisStore,
    AnalysisResult
} from "../../ports/repositories/analysis-store";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 중복 처리 방지 키의 바이트 길이 상한 지정
const MAX_IDEMPOTENCY_KEY_BYTES = 200;

// 영상 분석 입력 계약 정의
export type AnalysisInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string;
    // 검증된 경기 기록의 식별자
    matchId: string;
    // 재요청을 중복 실행하지 않기 위한 키
    idempotencyKey: string;
    // 원본 영상의 출처 주소
    sourceUrl?: string;
    // 원본 영상을 제공한 플랫폼
    sourcePlatform?: string;
}>;

// 영상 분석 정책 정의
export type AnalysisPolicy = Readonly<{
    // 분석 자료의 보존 기간 밀리초
    retentionMs: number;
    // 영상 처리 절차를 구별하는 버전
    pipelineVersion: string;
    // 파일 보존과 허용 형식 정책의 버전
    mediaPolicyVersion: string;
    // 분석 작업 입력 구조 버전
    jobPayloadVersion: number;
    // 분석 작업의 최대 실행 시도 횟수
    maxJobAttempts: number;
}>;

// 영상 분석 오류 정의
export type AnalysisError =
    | "IDEMPOTENCY_KEY_REQUIRED"
    | "IDEMPOTENCY_KEY_TOO_LONG"
    | "INVALID_ID";

// 영상 분석 처리 결과 정의
export type AnalysisOutcome =
    | AnalysisResult
    | Readonly<{
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "INVALID_INPUT";
            // 입력 거부 또는 처리 보류 사유
            reason: AnalysisError;
        }>;

// 영상 분석 의존 기능 계약 정의
export type AnalysisDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: AnalysisStore;
    // 크기와 보존 기간 등의 서비스 정책
    policy: AnalysisPolicy;
}>;

// 선택 문자열 정규화
const optionalText = (value: string | undefined): string | null => {
    // 선택값이 없으면 빈 값 반환
    if (value === undefined) {
        // 선택 문자열이 없으면 미입력 상태 반환
        return null;
    }

    // 선택값 공백 제거
    const normalized = value.trim();
    // 빈 선택값을 빈 값로 변환
    return normalized.length === 0 ? null : normalized;
};

// 식별자 형식 확인
const validIds = (
    input: Pick<AnalysisInput, "anonymousSessionId" | "videoAssetId" | "matchId">,
): boolean =>
    UUID_PATTERN.test(input.anonymousSessionId) &&
    UUID_PATTERN.test(input.videoAssetId) &&
    UUID_PATTERN.test(input.matchId);

// 멱등 키 확인
const idempotencyKey = (
    idempotencyKey: string,
): AnalysisError | null => {
    // 멱등 키 유니코드 길이 계산
    const byteLength = new TextEncoder().encode(idempotencyKey).byteLength;

    // 중복 실행 방지 키의 빈 값 확인
    if (byteLength === 0) {
        // 중복 실행 방지 키 필수 입력 오류 반환
        return "IDEMPOTENCY_KEY_REQUIRED";
    }

    // 중복 실행 방지 키의 바이트 길이 상한 확인
    if (byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
        // 너무 긴 중복 실행 방지 키 오류 반환
        return "IDEMPOTENCY_KEY_TOO_LONG";
    }

    // 허용된 멱등 키 반환
    return null;
};

// 분석 제출 유스케이스
export const analysis =
    ({ clock, hasher, repository, policy }: AnalysisDependencies) =>
    async (input: AnalysisInput): Promise<AnalysisOutcome> => {
        // 입력과 정책 스냅샷 생성
        const snapshot = {
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId: input.anonymousSessionId,
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId: input.videoAssetId,
            // 검증된 경기 기록의 식별자
            matchId: input.matchId,
            // 재요청을 중복 실행하지 않기 위한 키
            idempotencyKey: input.idempotencyKey,
            // 원본 영상의 출처 주소
            sourceUrl: input.sourceUrl,
            // 원본 영상을 제공한 플랫폼
            sourcePlatform: input.sourcePlatform,
            // 분석 자료의 보존 기간 밀리초
            retentionMs: policy.retentionMs,
            // 영상 처리 절차를 구별하는 버전
            pipelineVersion: policy.pipelineVersion,
            // 파일 보존과 허용 형식 정책의 버전
            mediaPolicyVersion: policy.mediaPolicyVersion,
            // 분석 작업 입력 구조 버전
            jobPayloadVersion: policy.jobPayloadVersion,
            // 분석 작업의 최대 실행 시도 횟수
            maxJobAttempts: policy.maxJobAttempts,
        };

        // 식별자 형식 확인
        if (!validIds(snapshot)) {
            // 분석 요청 식별자 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "INVALID_ID" };
        }

        // 멱등 키 형식 확인
        const idempotencyKeyError = idempotencyKey(snapshot.idempotencyKey);
        // 중복 실행 방지 키 검사 실패 여부 확인
        if (idempotencyKeyError !== null) {
            // 중복 실행 방지 키의 상세 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: idempotencyKeyError };
        }

        // 식별자 소문자 정규화
        const anonymousSessionId = snapshot.anonymousSessionId.toLowerCase();
        // 업로드된 원본 영상 기록의 식별자의 대소문자 차이 제거
        const videoAssetId = snapshot.videoAssetId.toLowerCase();
        // 검증된 경기 기록의 식별자의 대소문자 차이 제거
        const matchId = snapshot.matchId.toLowerCase();
        // 선택 문자열 정규화
        const sourceUrl = optionalText(snapshot.sourceUrl);
        // 선택 입력된 원본 플랫폼 이름의 빈 문자열 정리
        const sourcePlatform = optionalText(snapshot.sourcePlatform);
        // 요청 해시 입력 구성
        const requestHashInput = JSON.stringify({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId,
            // 검증된 경기 기록의 식별자
            matchId,
            // 원본 영상의 출처 주소
            sourceUrl,
            // 원본 영상을 제공한 플랫폼
            sourcePlatform,
            // 영상 처리 절차를 구별하는 버전
            pipelineVersion: snapshot.pipelineVersion,
            // 파일 보존과 허용 형식 정책의 버전
            mediaPolicyVersion: snapshot.mediaPolicyVersion,
        });
        // 멱등 키 해시 생성
        const keyHash = Uint8Array.from(await hasher.sha256(snapshot.idempotencyKey));
        // 요청 내용 해시 생성
        const requestHash = Uint8Array.from(await hasher.sha256(requestHashInput));
        // 현재 시각 조회
        const now = clock.now();

        // 분석 제출 명령 구성
        const command: AnalysisCommand = {
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId,
            // 검증된 경기 기록의 식별자
            matchId,
            // 원본 영상의 출처 주소
            sourceUrl,
            // 원본 영상을 제공한 플랫폼
            sourcePlatform,
            // 멱등 요청 키의 해시
            keyHash,
            // 동일 키로 다른 요청을 보냈는지 확인하는 해시
            requestHash,
            // 기록이 처음 생성된 시각
            createdAt: now.toISOString(),
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: new Date(now.getTime() + snapshot.retentionMs).toISOString(),
            // 영상 처리 절차를 구별하는 버전
            pipelineVersion: snapshot.pipelineVersion,
            // 파일 보존과 허용 형식 정책의 버전
            mediaPolicyVersion: snapshot.mediaPolicyVersion,
            // 분석 작업 입력 구조 버전
            jobPayloadVersion: snapshot.jobPayloadVersion,
            // 분석 작업의 최대 실행 시도 횟수
            maxJobAttempts: snapshot.maxJobAttempts,
        };

        // 분석 저장소 호출
        return repository.submission(command);
    };
