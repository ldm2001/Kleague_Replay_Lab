import type { Clock } from "../../ports/clock/clock";
import type { AnalysisResultStore, AnalysisView } from "../../ports/repositories/status-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 결과 조회 입력
export type ReportInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
}>;

export type ReportResult = AnalysisView | null | Readonly<{ kind: "INVALID_INPUT" }>;

export type ReportDependencies = Readonly<{
  clock: Clock;
  repository: AnalysisResultStore;
}>;

export const report =
  ({ clock, repository }: ReportDependencies) =>
  async (input: ReportInput): Promise<ReportResult> => {
    if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.analysisId)) {
      return { kind: "INVALID_INPUT" };
    }
    return repository.analysis({
      anonymousSessionId: input.anonymousSessionId.toLowerCase(),
      analysisId: input.analysisId.toLowerCase(),
      now: clock.now().toISOString(),
    });
  };
