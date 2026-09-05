import type { Clock } from "../../ports/clock/clock";
import type { LatestMediaStore } from "../../ports/repositories/status-store";

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
  clock: Clock;
  repository: LatestMediaStore;
}>;

export const latest =
  ({ clock, repository }: LatestDependencies) =>
  async (input: LatestInput): Promise<LatestResult> => {
    // 세션 식별자 확인
    if (!UUID.test(input.anonymousSessionId)) return { kind: "INVALID_INPUT" };
    // 최근 영상 식별자 조회
    const videoAssetId = await repository.latest({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      now: clock.now().toISOString(),
    });
    // 최근 영상 결과 변환
    return videoAssetId ? { videoAssetId } : null;
  };
