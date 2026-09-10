import type { RuleCitation } from "./citation";

export type PipelineFilterReason =
  | "INVALID_INTERVAL"
  | "INVALID_TRACKING"
  | "INVALID_SCENE_EVENT"
  | "SCENE_EVENT_UNAVAILABLE"
  | "SITUATION_OBSERVED"
  | "RULE_CLAUSES_UNAVAILABLE"
  | "TRACKING_UNAVAILABLE"
  | "TRACKING_INCOMPLETE"
  | "CAMERA_MOTION_UNVERIFIED"
  | "EVIDENCE_UNAVAILABLE"
  | "RULE_CONTEXT_UNVERIFIED"
  | "INCIDENT_UNCLASSIFIED"
  | "CONTACT_UNOBSERVED"
  | "INTENSITY_UNOBSERVED";

// 영상 안의 재개 관찰이며 실제 경기 시각이나 원심의 적법성을 확정하지 않는다
export type SceneEvent = Readonly<{
  kind: "CORNER_KICK";
  status: "OBSERVED";
  startMs: number;
  endMs: number;
  restartMs: number;
  evidenceTimestampsMs: readonly number[];
  method: "corner-geometry-motion-v1";
}>;

// API 수신과 저장된 결과의 재평가가 같은 시간 범위 계약을 사용한다
export function sceneEventData(value: unknown, startMs: number, endMs: number): value is SceneEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const time = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!time(startMs) || !time(endMs) || endMs <= startMs ||
      item.kind !== "CORNER_KICK" || item.status !== "OBSERVED" || item.method !== "corner-geometry-motion-v1" ||
      !time(item.startMs) || !time(item.endMs) || !time(item.restartMs) ||
      item.startMs < startMs || item.endMs > endMs || item.restartMs <= item.startMs || item.restartMs >= item.endMs ||
      !Array.isArray(item.evidenceTimestampsMs) || item.evidenceTimestampsMs.length < 2 || item.evidenceTimestampsMs.length > 256) return false;
  const eventStart = item.startMs;
  const eventEnd = item.endMs;
  const times = item.evidenceTimestampsMs;
  return times.every((value, index) => time(value) && value >= eventStart && value <= eventEnd &&
    (index === 0 || value > times[index - 1])) && times[0] < item.restartMs && times[times.length - 1] >= item.restartMs;
}

export type PipelineRuleCondition = Readonly<{
  code: "CORNER_PLACEMENT" | "CORNER_RESTART" | "CORNER_DISTANCE" | "DIRECT_CORNER_OFFSIDE";
  description: string;
  status: "UNVERIFIED";
  law: string;
  section: string;
  sourceUrl: string;
}>;

// 상황 인식과 규정 조건의 연결은 조건 충족이나 반칙 판정과 구분한다
export type PipelineFilterResult = Readonly<{
  filterVersion: string;
  status: "EXCLUDED" | "UNDETERMINED" | "OBSERVED" | "APPLICABLE";
  reasonCodes: readonly PipelineFilterReason[];
  missingFields: readonly string[];
  ruleReferences: readonly RuleCitation[];
  evidenceIds: readonly string[];
  trackingStatus?: "UNAVAILABLE" | "PARTIAL" | "POSITION_ONLY" | "CAMERA_COMPENSATED" | "MOTION_ONSET";
  situation?: "CORNER_KICK";
  referenceOnly?: boolean;
  conditions?: readonly PipelineRuleCondition[];
}>;
