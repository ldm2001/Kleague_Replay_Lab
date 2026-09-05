import type { Clock } from "../../ports/clock/clock";
import type { EvidenceMedia, EvidenceMediaStore } from "../../ports/repositories/status-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 증거 조회 입력
export type AssetInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  evidenceId: string;
}>;

// 증거 미디어 결과
export type AssetResult = EvidenceMedia | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 증거 미디어 의존성
export type AssetDependencies = Readonly<{
  clock: Clock;
  repository: EvidenceMediaStore;
}>;

export const asset =
  ({ clock, repository }: AssetDependencies) =>
  async (input: AssetInput): Promise<AssetResult> => {
    // 세션과 분석과 증거 식별자 확인
    if (![input.anonymousSessionId, input.analysisId, input.evidenceId].every((value) => UUID.test(value))) {
      return { kind: "INVALID_INPUT" };
    }
    // 증거 미디어 저장소 조회
    // 식별자 소문자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    const analysisId = input.analysisId.toLowerCase();
    const evidenceId = input.evidenceId.toLowerCase();
    // 미디어 저장소 호출
    return repository.media({
      anonymousSessionId,
      analysisId,
      evidenceId,
      now: clock.now().toISOString(),
    });
  };
