import { AUTOMATIC_NOT_ASSESSED, publicAutomaticResult, observation, type AutomaticJudgment } from "@replay/shared-types";
import { combineCompetitionRules } from "@replay/rule-data";
import { pushResult } from "@replay/rule-engine";
import { context } from "./push-context";

// 합성 연결 시험용 판정. 운영 영상 인식 결과가 아니다.
export const automaticJudgment = (candidateIndex = 1): AutomaticJudgment => ({
  kind: "AUTOMATIC_PUSHING", status: "COMPLETED", evaluatorVersion: "automatic-review-v1",
  sourceSha256: "a".repeat(64), candidateIndex,
  rule: { id: "44444444-4444-4444-8444-444444444444", matchId: "55555555-5555-4555-8555-555555555555",
    competition: "K리그2", season: "2026", ifabVersionId: "ifab-2025-26", verificationStatus: "VERIFIED" },
  producer: { methodId: "test-only", version: "1", validationReportSha256: "b".repeat(64) },
  evidenceIds: [`${String(candidateIndex).padStart(8, "0")}-3333-4333-8333-333333333333`],
  result: publicAutomaticResult(pushResult({ contactDetected: observation(true, "NORMAL", []), severity: observation("CARELESS", "NORMAL", []),
    opponentDisplacement: observation("none", "NORMAL", []), insidePenaltyArea: observation(false, "NORMAL", []),
    cameraSufficiency: "HIGH", context: context() }, combineCompetitionRules({ competition: "K리그2", season: "2026", ifabVersionId: "ifab-2025-26" })!)),
  notAssessed: AUTOMATIC_NOT_ASSESSED,
});
