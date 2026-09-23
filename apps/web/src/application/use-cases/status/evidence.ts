// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상과 분석 진행 상태 조회 계약 가져옴
import type { EvidenceMedia, EvidenceMediaStore } from "../../ports/repositories/status-store";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 증거 조회 입력
export type AssetInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 저장된 증거 자산의 식별자
    evidenceId: string;
}>;

// 증거 미디어 결과
export type AssetResult = EvidenceMedia | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 증거 미디어 의존성
export type AssetDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: EvidenceMediaStore;
}>;

// 접근 가능한 증거 파일 조회
export const asset =
    ({ clock, repository }: AssetDependencies) =>
    async (input: AssetInput): Promise<AssetResult> => {
        // 세션과 분석과 증거 식별자 확인
        if (
            ![input.anonymousSessionId, input.analysisId, input.evidenceId].every((value) =>
                UUID.test(value)
            )
        ) {
            // 증거 조회 식별자 오류 반환
            return { kind: "INVALID_INPUT" };
        }
        // 증거 미디어 저장소 조회
        // 식별자 소문자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 분석 기록의 식별자의 대소문자 차이 제거
        const analysisId = input.analysisId.toLowerCase();
        // 저장된 증거 자산의 식별자의 대소문자 차이 제거
        const evidenceId = input.evidenceId.toLowerCase();
        // 미디어 저장소 호출
        return repository.media({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 분석 기록의 식별자
            analysisId,
            // 저장된 증거 자산의 식별자
            evidenceId,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString()
        });
    };
