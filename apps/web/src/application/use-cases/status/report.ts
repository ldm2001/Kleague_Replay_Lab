import type { Clock } from "../../ports/clock/clock";
import type { AnalysisResultStore, AnalysisView, CandidateView } from "../../ports/repositories/status-store";
import { broadcastCueData, VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";

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

// 서버가 계산한 범위 평가만 공개한다. 기존 판정 이력과 단순 장면 인식은 완료 근거가 아니다.
const completedScope = (candidate: CandidateView): boolean => {
  const value = candidate.varScopeEvaluation;
  const cue = candidate.broadcastCue;
  if (!value || candidate.filter?.status === "EXCLUDED" ||
      !broadcastCueData(cue, candidate.startMs, candidate.endMs) ||
      value.kind !== "COMPETITION_VAR_SCOPE" || value.status !== "COMPLETED" ||
      value.topic !== "GOAL_RELATED" || value.included !== true ||
      value.provenance?.origin !== "VIDEO_CUE_AND_COMPETITION_RULES" ||
      value.provenance.evaluatorVersion !== "competition-var-scope-v1" ||
      value.provenance.cueMethod !== cue.method || value.provenance.cueStartMs !== cue.startMs || value.provenance.cueEndMs !== cue.endMs ||
      !/^[0-9a-f]{64}$/.test(value.provenance.sourceSha256) || !/^[0-9a-f]{64}$/.test(value.provenance.ruleDocumentSha256) ||
      !Array.isArray(value.citations) || value.citations.length === 0 ||
      !Array.isArray(value.evidenceIds) || value.evidenceIds.length === 0 ||
      !Array.isArray(value.notAssessed) || !VAR_SCOPE_NOT_ASSESSED.every((item) => value.notAssessed.includes(item))) return false;
  const clips = new Set((candidate.evidence ?? []).filter((item) => item.kind === "CLIP").map((item) => item.evidenceId));
  return value.evidenceIds.every((id) => clips.has(id)) &&
    value.citations.every((item) => item.authority === "KLEAGUE" && item.edition === value.season && item.ruleId.startsWith(`${value.ruleVersionId}-`));
};

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
    const result = await repository.analysis({
      anonymousSessionId,
      analysisId,
      now: clock.now().toISOString(),
    });
    // 과거 수동 평가 이력의 조회 계약은 유지한다
    if (!result || !result.diagnostics) return result;
    // 범위 평가의 완료는 전체 파울 판정 완료와 별개이며 기존 MODEL·USER·CURATOR 판정은 재사용하지 않는다
    const { diagnostics: _diagnostics, filterSummary: _filterSummary, ...publicResult } = result;
    const candidates = result.candidates.filter(completedScope)
      .sort((first, second) => first.startMs - second.startMs || first.index - second.index)
      .map((candidate): CandidateView => {
        // 독립 범위 평가에 사용하지 않은 과거 사실·판정·원시 진단은 공개 결과에 섞지 않는다
        const { judgment: _judgment, facts: _facts, factRevisionId: _revision, observation: _observation,
          filter: _filter, tracking: _tracking, sceneEvent: _sceneEvent, ...visible } = candidate;
        const cue = candidate.broadcastCue!;
        return { ...visible, judgment: null, signalScore: null, reasons: [],
          broadcastCue: { kind: cue.kind, method: cue.method, startMs: cue.startMs, endMs: cue.endMs,
            evidenceTimestampsMs: [...cue.evidenceTimestampsMs] } };
      });
    return {
      ...publicResult,
      resultPolicy: "COMPLETED_ONLY",
      mode: "VISUAL_CHANGE_BASELINE",
      judgmentStatus: "NOT_EVALUATED",
      evaluatedCount: 0,
      rule: null,
      completedScopeCount: candidates.length,
      candidates,
    };
  };
