import type { AnalysisView, CandidateView, JudgmentView } from "@replay/application";
import { observation } from "@replay/shared-types";

const citation = (authority: "IFAB" | "KLEAGUE", index: number) => ({
  ruleId: `${authority.toLowerCase()}-${index}`,
  ruleRevision: 1,
  ruleContentSha256: "01".repeat(32),
  authority,
  edition: authority === "IFAB" ? "2026-27" : "2026",
  law: authority === "IFAB" ? "12" : "25",
  section: "1",
  relevance: authority === "IFAB" ? "PRIMARY" as const : "SUPPORTING" as const,
  quoteSnapshot: authority === "IFAB" ? "밀기와 차징은 강도에 따라 판단" : "VAR은 네 가지 상황에 적용",
  sourcePage: "1",
  sourceUrl: "https://example.test/rule",
});

export const judgment: JudgmentView = {
  factRevisionId: "77777777-7777-4777-8777-777777777777",
  facts: {
    push: {
      contactDetected: observation(true, "NORMAL", []),
      severity: observation("RECKLESS", "NORMAL", []),
      opponentDisplacement: observation("clear", "NORMAL", []),
      insidePenaltyArea: observation(false, "NORMAL", []),
      cameraSufficiency: "HIGH",
    },
    variable: {
      reviewScenario: "GOAL_DISALLOWED",
      restartOccurred: false,
      sendOffCategory: "NONE",
      mistakenIdentity: false,
      decisionNature: "SUBJECTIVE",
      errorMagnitude: "UNDETERMINED",
      seriousMissedIncident: false,
    },
    observed: {
      restartType: "DIRECT_FREE_KICK",
      restartBeneficiary: "DEFENDING_TEAM",
      card: "NONE",
      goalDecision: "NO_GOAL",
      source: "USER_INPUT",
    },
  },
  source: "USER",
  decision: "FOUL",
  severity: "RECKLESS",
  restart: "DIRECT_FREE_KICK",
  disciplinary: "CAUTION",
  decisionMatch: "UNDETERMINED",
  confidence: "HIGH",
  inconclusiveReason: null,
  varAssessment: {
    reviewable: true,
    category: "GOAL_NO_GOAL",
    withinTimeWindow: true,
    thresholdMet: "UNDETERMINED",
    reviewProcedure: "OFR",
    intervention: "NO_INTERVENTION",
    noInterventionReason: null,
    notReviewableReason: null,
    windowClosedReason: null,
    windowException: "NONE",
    explanation: "명백하고 분명한 오류 여부는 판단 보류",
  },
  citations: [citation("IFAB", 1), citation("KLEAGUE", 2)],
};

export const candidate = (index: number, value: JudgmentView | null = null): CandidateView => ({
  id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
  index: index + 1,
  startMs: index * 1000,
  endMs: index * 1000 + 2000,
  anchorMs: index * 1000 + 1000,
  signalScore: .41 + index / 100,
  cameraSufficiency: "MEDIUM",
  reasons: ["motion_spike"],
  evidence: [
    { evidenceId: `${String(index + 1).padStart(8, "0")}-2222-4222-8222-222222222222`, kind: "FRAME" },
    { evidenceId: `${String(index + 1).padStart(8, "0")}-3333-4333-8333-333333333333`, kind: "CLIP" },
  ],
  judgment: value,
});

export const analysis = (count = 3): AnalysisView => ({
  analysisId: "22222222-2222-4222-8222-222222222222",
  mode: "VISUAL_CHANGE_BASELINE",
  judgmentStatus: "PARTIAL",
  status: "CANDIDATES_READY",
  stage: "SUCCEEDED",
  progressPercent: 100,
  failureCode: null,
  limitations: ["incident_category_classification_pending"],
  rule: {
    competition: "K리그1",
    season: "2026",
    ifabEdition: "2026-27",
    verificationStatus: "VERIFIED_KLEAGUE_INFERRED_IFAB",
    sourceUrl: "https://www.kleague.com/about/competition.do",
  },
  evaluatedCount: 1,
  candidates: Array.from({ length: count }, (_, index) => candidate(index, index === 1 ? judgment : null)),
});
