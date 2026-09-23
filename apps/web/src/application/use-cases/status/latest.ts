// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상과 분석 진행 상태 조회 계약 가져옴
import type { LatestMediaStore } from "../../ports/repositories/status-store";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 최근 영상 입력
export type LatestInput = Readonly<{ anonymousSessionId: string }>;

// 최근 영상 결과
export type LatestResult =
    | Readonly<{ videoAssetId: string }>
    | null
    | Readonly<{ kind: "INVALID_INPUT" }>;

// 최근 영상 의존성
export type LatestDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: LatestMediaStore;
}>;

// 최근 분석 조회
export const latest =
    ({ clock, repository }: LatestDependencies) =>
    async (input: LatestInput): Promise<LatestResult> => {
        // 세션 식별자 확인
        if (!UUID.test(input.anonymousSessionId)) return { kind: "INVALID_INPUT" };
        // 최근 영상 식별자 조회
        const videoAssetId = await repository.latest({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId: input.anonymousSessionId.toLowerCase(),
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString(),
        });
        // 최근 영상 결과 변환
        return videoAssetId ? { videoAssetId } : null;
    };
