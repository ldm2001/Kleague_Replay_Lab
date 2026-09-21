import type { Clock } from "../../ports/clock/clock";
import type { AnalysisResultStore, AnalysisView, CandidateView } from "../../ports/repositories/status-store";
import { AUTOMATIC_NOT_ASSESSED, AUTOMATIC_REVIEW_VERSION, publicAutomaticResult, broadcastCueData, VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";

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

const completedAutomatic = (candidate: CandidateView): boolean => {
  const value = candidate.automaticJudgment;
  if (!value || value.kind !== "AUTOMATIC_PUSHING" || value.status !== "COMPLETED" ||
      value.evaluatorVersion !== AUTOMATIC_REVIEW_VERSION || value.candidateIndex !== candidate.index ||
      !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !value.producer?.methodId || !value.producer.version ||
      !/^[a-f0-9]{64}$/.test(value.producer.validationReportSha256) || value.rule?.verificationStatus !== "VERIFIED" ||
      !UUID.test(value.rule.id) || !UUID.test(value.rule.matchId) || candidate.filter?.status === "EXCLUDED" ||
      !value.result || !["FOUL", "NO_FOUL"].includes(value.result.decision) ||
      !value.result.restart || value.result.restart === "UNKNOWN" || value.result.disciplinary === null ||
      value.result.inconclusiveReason !== null || value.result.varAssessment !== null ||
      !Array.isArray(value.result.citations) || !value.result.citations.length ||
      !value.result.citations.some((citation) => citation.authority === "IFAB" && `ifab-${citation.edition}` === value.rule.ifabVersionId) ||
      !Array.isArray(value.notAssessed) || !AUTOMATIC_NOT_ASSESSED.every((item) => value.notAssessed.includes(item)) ||
      !Array.isArray(value.evidenceIds) || !value.evidenceIds.length) return false;
  const evidence = new Map((candidate.evidence ?? []).map((item) => [item.evidenceId, item.kind]));
  return value.evidenceIds.every((id) => evidence.has(id)) && value.evidenceIds.some((id) => evidence.get(id) === "CLIP");
};

// 결과 조회와 진행 조회가 같은 공개 경계를 사용한다.
export const publicAnalysis = (result: AnalysisView): AnalysisView => {
  if (!result.diagnostics && !result.automaticReviewSummary && result.resultPolicy !== "COMPLETED_ONLY") return result;
  const { diagnostics: _diagnostics, filterSummary: _filterSummary, automaticReviewSummary: _review, ...publicResult } = result;
  const candidates = result.candidates.filter((candidate) => completedScope(candidate) || completedAutomatic(candidate))
    .sort((first, second) => first.startMs - second.startMs || first.index - second.index)
    .map((candidate): CandidateView => {
      const { judgment: _judgment, facts: _facts, factRevisionId: _revision, observation: _observation,
        filter: _filter, tracking: _tracking, sceneEvent: _sceneEvent, automaticJudgment: _automatic,
        varScopeEvaluation: _scope, broadcastCue: _cue, ...visible } = candidate;
      const cue = completedScope(candidate) ? candidate.broadcastCue : null;
      return { ...visible, judgment: null, signalScore: null, reasons: [],
        ...(completedAutomatic(candidate) ? { automaticJudgment: { ...candidate.automaticJudgment!,
          result: publicAutomaticResult(candidate.automaticJudgment!.result) } } : {}),
        ...(cue ? { varScopeEvaluation: candidate.varScopeEvaluation, broadcastCue: { kind: cue.kind, method: cue.method,
          startMs: cue.startMs, endMs: cue.endMs, evidenceTimestampsMs: [...cue.evidenceTimestampsMs] } } : {}),
      };
    });
  const evaluatedCount = candidates.filter((candidate) => candidate.automaticJudgment != null).length;
  return { ...publicResult, resultPolicy: "COMPLETED_ONLY",
    mode: evaluatedCount ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
    // 지원 밀기 질문의 완료를 영상의 모든 파울 평가 완료로 확대하지 않는다.
    judgmentStatus: evaluatedCount ? "PARTIAL" : "NOT_EVALUATED", evaluatedCount, rule: null,
    completedScopeCount: candidates.filter((candidate) => candidate.varScopeEvaluation != null).length, candidates };
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
    return result ? publicAnalysis(result) : null;
  };
