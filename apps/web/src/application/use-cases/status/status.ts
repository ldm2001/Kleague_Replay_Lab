import type { Clock } from "../../ports/clock/clock";
import type { MediaStatusStore, MediaView } from "../../ports/repositories/status-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 상태 조회 입력
export type StatusInput = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
}>;

export type StatusResult = MediaView | null | Readonly<{ kind: "INVALID_INPUT" }>;

export type StatusDependencies = Readonly<{
  clock: Clock;
  repository: MediaStatusStore;
}>;

export const status =
  ({ clock, repository }: StatusDependencies) =>
  async (input: StatusInput): Promise<StatusResult> => {
    if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.videoAssetId)) {
      return { kind: "INVALID_INPUT" };
    }
    return repository.status({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      videoAssetId: input.videoAssetId.toLowerCase(),
      now: clock.now().toISOString(),
    });
  };
