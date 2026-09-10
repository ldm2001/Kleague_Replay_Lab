import type { PipelineFilterReason, PipelineFilterResult, PipelineRuleCondition, RuleCitation, RuleSet } from "@replay/shared-types";
import { sceneEventData, trackingData } from "@replay/shared-types";

type PipelineCandidate = Readonly<{
  startMs: number;
  endMs: number;
  anchorMs: number | null;
  evidenceIds: readonly string[];
  category: string;
  tracking?: unknown;
  sceneEvent?: unknown;
}>;

// 판본 미확정일 때 이 주소들은 참고 주제이며 경기 적용 규정의 인용이 아니다
const cornerConditions = (references: readonly RuleCitation[]): readonly PipelineRuleCondition[] => {
  const cornerUrl = references.find((reference) => reference.law === "17")?.sourceUrl ?? "https://www.theifab.com/laws/latest/the-corner-kick/";
  const offsideUrl = references.find((reference) => reference.law === "11")?.sourceUrl ?? "https://www.theifab.com/laws/latest/offside/";
  return [
    { code: "CORNER_PLACEMENT", description: "공을 해당 코너 구역에 놓았는지 확인이 필요합니다", status: "UNVERIFIED", law: "17", section: "1", sourceUrl: cornerUrl },
    { code: "CORNER_RESTART", description: "정지한 공을 공격 팀 선수가 차서 명확히 움직였는지 확인이 필요합니다", status: "UNVERIFIED", law: "17", section: "1", sourceUrl: cornerUrl },
    { code: "CORNER_DISTANCE", description: "공이 인플레이가 될 때까지 상대 선수가 코너 아크에서 9.15m를 유지했는지 확인이 필요합니다", status: "UNVERIFIED", law: "17", section: "1", sourceUrl: cornerUrl },
    { code: "DIRECT_CORNER_OFFSIDE", description: "코너킥에서 직접 공을 받은 경우에만 해당 오프사이드 예외를 검토합니다", status: "UNVERIFIED", law: "11", section: "3", sourceUrl: offsideUrl },
  ];
};

// 변화 기반 산출물의 규정 적용 가능성 검사이며 반칙 판정기가 아니다
export function pipelineFilter(candidate: PipelineCandidate, rules: RuleSet | null): PipelineFilterResult {
  // 이 함수는 산출물의 규정 적용 가능성만 판정하며 접촉이나 파울을 추론하지 않는다
  const base = { filterVersion: "pipeline-rules-v3", evidenceIds: [...candidate.evidenceIds] };
  if (!Number.isSafeInteger(candidate.startMs) || candidate.startMs < 0 ||
      !Number.isSafeInteger(candidate.endMs) || candidate.endMs <= candidate.startMs ||
      (candidate.anchorMs !== null && (!Number.isSafeInteger(candidate.anchorMs) ||
        candidate.anchorMs < candidate.startMs || candidate.anchorMs > candidate.endMs))) {
    return { ...base, status: "EXCLUDED", reasonCodes: ["INVALID_INTERVAL"], missingFields: [], ruleReferences: [] };
  }
  if (candidate.sceneEvent != null && !sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)) {
    return { ...base, status: "EXCLUDED", reasonCodes: ["INVALID_SCENE_EVENT"], missingFields: [], ruleReferences: [] };
  }

  const reasonCodes: PipelineFilterReason[] = [];
  const missingFields: string[] = [];
  let trackingStatus: PipelineFilterResult["trackingStatus"] = "UNAVAILABLE";
  // 추적 메타데이터도 DB나 구버전 Worker에서 잘못 들어올 수 있으므로 여기서 다시 확인한다
  if (candidate.tracking != null) {
    if (!trackingData(candidate.tracking, candidate.startMs, candidate.endMs)) {
      return { ...base, status: "EXCLUDED", reasonCodes: ["INVALID_TRACKING"], missingFields: [], ruleReferences: [], trackingStatus };
    }
    const tracking = candidate.tracking;
    if (tracking.coverage !== "COMPLETE") {
      trackingStatus = "PARTIAL";
      reasonCodes.push("TRACKING_INCOMPLETE");
    } else if (tracking.selectedCount > 0) {
      trackingStatus = tracking.motionOnsetsMs.length > 0 ? "MOTION_ONSET" : tracking.cameraCount > 0 ? "CAMERA_COMPENSATED" : "POSITION_ONLY";
      if (trackingStatus === "POSITION_ONLY") reasonCodes.push("CAMERA_MOTION_UNVERIFIED");
    }
  }
  if (trackingStatus === "UNAVAILABLE") reasonCodes.push("TRACKING_UNAVAILABLE");
  if (candidate.evidenceIds.length === 0) reasonCodes.push("EVIDENCE_UNAVAILABLE");
  if (!rules) {
    reasonCodes.push("RULE_CONTEXT_UNVERIFIED");
    missingFields.push("verifiedRuleContext");
  }
  if (sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)) {
    if (candidate.evidenceIds.length === 0) {
      return { ...base, status: "UNDETERMINED", reasonCodes, missingFields: [...missingFields, "sceneEvidence"], ruleReferences: [], trackingStatus };
    }
    // 코너킥의 관찰로 검토할 조항만 선택하며 절차 준수나 오프사이드 예외 충족을 만들지 않는다
    const procedure = rules?.cite("LAW_17_CORNER_PROCEDURE").filter((reference) => reference.law === "17" && reference.section === "1") ?? [];
    const offside = rules?.cite("LAW_11_DIRECT_RESTART_OFFSIDE").filter((reference) => reference.law === "11" && reference.section === "3") ?? [];
    const referenceOnly = procedure.length === 0 || offside.length === 0;
    const ruleReferences = referenceOnly ? [] : [...procedure, ...offside];
    reasonCodes.push("SITUATION_OBSERVED");
    if (rules && referenceOnly) {
      reasonCodes.push("RULE_CLAUSES_UNAVAILABLE");
      missingFields.push("cornerRuleClauses");
    }
    return {
      ...base, status: referenceOnly ? "OBSERVED" : "APPLICABLE", situation: "CORNER_KICK", referenceOnly,
      reasonCodes, missingFields: [...missingFields, "cornerPlacement", "stationaryKick", "opponentDistance", "directReception"],
      ruleReferences, trackingStatus, conditions: cornerConditions(ruleReferences),
    };
  }
  if (candidate.category === "CORNER_KICK") {
    reasonCodes.push("SCENE_EVENT_UNAVAILABLE");
    return { ...base, status: "UNDETERMINED", reasonCodes, missingFields: [...missingFields, "sceneEvent"], ruleReferences: [], trackingStatus };
  }
  if (candidate.category === "OTHER") {
    reasonCodes.push("INCIDENT_UNCLASSIFIED");
    missingFields.push("incidentCategory");
  }
  // 점수와 과거 사용자 및 모델 입력으로 누락된 영상 사실을 대체하지 않는다
  reasonCodes.push("CONTACT_UNOBSERVED", "INTENSITY_UNOBSERVED");
  missingFields.push("contact", "intensity");
  return {
    ...base, status: "UNDETERMINED", reasonCodes, missingFields, trackingStatus,
    ruleReferences: rules ? [...rules.cite("LAW_12_DIRECT_FREE_KICK"), ...rules.cite("VAR_REVIEW_PROCESS")] : [],
  };
}
