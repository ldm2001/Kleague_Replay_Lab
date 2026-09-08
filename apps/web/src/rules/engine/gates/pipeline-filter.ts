import type { PipelineFilterReason, PipelineFilterResult, RuleSet } from "@replay/shared-types";

type PipelineCandidate = Readonly<{
  startMs: number;
  endMs: number;
  anchorMs: number | null;
  evidenceIds: readonly string[];
  category: string;
}>;

// 변화 기반 산출물의 규정 적용 가능성 검사이며 반칙 판정기가 아니다
export function pipelineFilter(candidate: PipelineCandidate, rules: RuleSet | null): PipelineFilterResult {
  // 이 함수는 산출물의 규정 적용 가능성만 판정하며 접촉이나 파울을 추론하지 않는다
  const base = { filterVersion: "pipeline-rules-v1", evidenceIds: [...candidate.evidenceIds] };
  if (!Number.isSafeInteger(candidate.startMs) || candidate.startMs < 0 ||
      !Number.isSafeInteger(candidate.endMs) || candidate.endMs <= candidate.startMs ||
      (candidate.anchorMs !== null && (!Number.isSafeInteger(candidate.anchorMs) ||
        candidate.anchorMs < candidate.startMs || candidate.anchorMs > candidate.endMs))) {
    return { ...base, status: "EXCLUDED", reasonCodes: ["INVALID_INTERVAL"], missingFields: [], ruleReferences: [] };
  }

  const reasonCodes: PipelineFilterReason[] = [];
  const missingFields: string[] = [];
  if (candidate.evidenceIds.length === 0) reasonCodes.push("EVIDENCE_UNAVAILABLE");
  if (!rules) {
    reasonCodes.push("RULE_CONTEXT_UNVERIFIED");
    missingFields.push("verifiedRuleContext");
  }
  if (candidate.category === "OTHER") {
    reasonCodes.push("INCIDENT_UNCLASSIFIED");
    missingFields.push("incidentCategory");
  }
  // 점수와 과거 사용자 및 모델 입력으로 누락된 영상 사실을 대체하지 않는다
  reasonCodes.push("CONTACT_UNOBSERVED", "INTENSITY_UNOBSERVED");
  missingFields.push("contact", "intensity");
  return {
    ...base, status: "UNDETERMINED", reasonCodes, missingFields,
    ruleReferences: rules ? [...rules.cite("LAW_12_DIRECT_FREE_KICK"), ...rules.cite("VAR_REVIEW_PROCESS")] : [],
  };
}
