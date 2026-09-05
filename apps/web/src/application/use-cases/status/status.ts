import type { Clock } from "../../ports/clock/clock";
import type { MediaStatusStore, MediaView } from "../../ports/repositories/status-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 상태 조회 입력
export type StatusInput = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
}>;

// 영상 상태 결과
export type StatusResult = MediaView | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 영상 상태 의존성
export type StatusDependencies = Readonly<{
  clock: Clock;
  repository: MediaStatusStore;
}>;

export const status =
  ({ clock, repository }: StatusDependencies) =>
  async (input: StatusInput): Promise<StatusResult> => {
    // 세션과 영상 식별자 확인
    if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.videoAssetId)) {
      return { kind: "INVALID_INPUT" };
    }
    // 영상 상태 저장소 조회
    // 식별자 소문자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    const videoAssetId = input.videoAssetId.toLowerCase();
    // 상태 저장소 호출
    return repository.status({
      anonymousSessionId,
      videoAssetId,
      now: clock.now().toISOString(),
    });
  };
