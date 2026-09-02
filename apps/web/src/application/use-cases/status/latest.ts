import type { Clock } from "../../ports/clock/clock";
import type { LatestMediaRepo } from "../../ports/repositories/status-repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LatestInput = Readonly<{ anonymousSessionId: string }>;

export type LatestResult =
  | Readonly<{ videoAssetId: string }>
  | null
  | Readonly<{ kind: "INVALID_INPUT" }>;

export type LatestDependencies = Readonly<{
  clock: Clock;
  repository: LatestMediaRepo;
}>;

export const latest =
  ({ clock, repository }: LatestDependencies) =>
  async (input: LatestInput): Promise<LatestResult> => {
    if (!UUID.test(input.anonymousSessionId)) return { kind: "INVALID_INPUT" };
    const videoAssetId = await repository.latest({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      now: clock.now().toISOString(),
    });
    return videoAssetId ? { videoAssetId } : null;
  };
