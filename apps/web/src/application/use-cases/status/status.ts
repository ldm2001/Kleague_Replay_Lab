// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상과 분석 진행 상태 조회 계약 가져옴
import type { MediaStatusStore, MediaView } from "../../ports/repositories/status-store";
// 현재 모듈에서 사용하는 외부 기능과 자료 계약 가져옴
import { publicAnalysis } from "./report";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 상태 조회 입력
export type StatusInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string;
}>;

// 영상 상태 결과
export type StatusResult = MediaView | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 영상 상태 의존성
export type StatusDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: MediaStatusStore;
}>;

// 상태 처리
export const status =
    ({ clock, repository }: StatusDependencies) =>
    async (input: StatusInput): Promise<StatusResult> => {
        // 세션과 영상 식별자 확인
        if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.videoAssetId)) {
            // 영상 상태 조회 식별자 오류 반환
            return { kind: "INVALID_INPUT" };
        }
        // 영상 상태 저장소 조회
        // 식별자 소문자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 업로드된 원본 영상 기록의 식별자의 대소문자 차이 제거
        const videoAssetId = input.videoAssetId.toLowerCase();
        // 상태 저장소 호출
        const result = await repository.status({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 업로드된 원본 영상 기록의 식별자
            videoAssetId,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString(),
        });
        // 연결된 분석은 완료 공개 정책을 적용한 뒤 상태 자료 반환
        return result?.analysis ? { ...result, analysis: publicAnalysis(result.analysis) } : result;
    };
