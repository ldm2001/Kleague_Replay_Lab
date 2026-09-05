import type { Clock } from "../../ports/clock/clock";
import type { AnalysisResultStore, AnalysisView } from "../../ports/repositories/status-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 결과 조회 입력
export type ReportInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
}>;

// 분석 결과 조회 결과
export type ReportResult = AnalysisView | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 분석 결과 의존성
export type ReportDependencies = Readonly<{
  clock: Clock;
  repository: AnalysisResultStore;
}>;

export const report =
  ({ clock, repository }: ReportDependencies) =>
  async (input: ReportInput): Promise<ReportResult> => {
    // 세션과 분석 식별자 확인
    if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.analysisId)) {
      return { kind: "INVALID_INPUT" };
    }
    // 분석 결과 저장소 조회
    // 식별자 소문자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    const analysisId = input.analysisId.toLowerCase();
    // 결과 저장소 호출
    return repository.analysis({
      anonymousSessionId,
      analysisId,
      now: clock.now().toISOString(),
    });
  };
