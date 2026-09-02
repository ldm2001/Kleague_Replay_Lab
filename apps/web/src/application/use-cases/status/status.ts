import type { Clock } from "../../ports/clock/clock";
import type { MediaStatusRepo, MediaView } from "../../ports/repositories/status-repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StatusInput = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
}>;

export type StatusResult = MediaView | null | Readonly<{ kind: "INVALID_INPUT" }>;

export type StatusDependencies = Readonly<{
  clock: Clock;
  repository: MediaStatusRepo;
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
