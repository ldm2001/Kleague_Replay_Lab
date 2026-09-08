import type { RuleCitation } from "./citation";

export type PipelineFilterReason =
  | "INVALID_INTERVAL"
  | "EVIDENCE_UNAVAILABLE"
  | "RULE_CONTEXT_UNVERIFIED"
  | "INCIDENT_UNCLASSIFIED"
  | "CONTACT_UNOBSERVED"
  | "INTENSITY_UNOBSERVED";

// 현재 변화 기반 파이프라인은 규정상 접촉 사실을 산출하지 않는다
export type PipelineFilterResult = Readonly<{
  filterVersion: string;
  status: "EXCLUDED" | "UNDETERMINED";
  reasonCodes: readonly PipelineFilterReason[];
  missingFields: readonly string[];
  ruleReferences: readonly RuleCitation[];
  evidenceIds: readonly string[];
}>;
