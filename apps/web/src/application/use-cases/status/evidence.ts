import type { Clock } from "../../ports/clock/clock";
import type { EvidenceMedia, EvidenceMediaRepo } from "../../ports/repositories/status-repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssetInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  evidenceId: string;
}>;

export type AssetResult = EvidenceMedia | null | Readonly<{ kind: "INVALID_INPUT" }>;

export type AssetDependencies = Readonly<{
  clock: Clock;
  repository: EvidenceMediaRepo;
}>;

export const asset =
  ({ clock, repository }: AssetDependencies) =>
  async (input: AssetInput): Promise<AssetResult> => {
    if (![input.anonymousSessionId, input.analysisId, input.evidenceId].every((value) => UUID.test(value))) {
      return { kind: "INVALID_INPUT" };
    }
    return repository.media({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      analysisId: input.analysisId.toLowerCase(),
      evidenceId: input.evidenceId.toLowerCase(),
      now: clock.now().toISOString(),
    });
  };
