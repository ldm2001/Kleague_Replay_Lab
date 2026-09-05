import type { Hasher } from "../../ports/hashing/hasher";
import type { Clock } from "../../ports/clock/clock";
import type { EvaluationStore, FactPatchResult } from "../../ports/repositories/evaluation-store";
import type { EvaluationFacts } from "@replay/shared-types";
import {
  CAMERA_SUFFICIENCY_LEVELS,
  DECISION_NATURES,
  DISCIPLINARY_ACTIONS,
  DISPLACEMENT_LEVELS,
  ERROR_MAGNITUDES,
  GOAL_DECISIONS,
  OBSERVATION_SPEEDS,
  OBSERVED_SEVERITIES,
  OBSERVED_SOURCES,
  RESTART_BENEFICIARIES,
  RESTART_TYPES,
  REVIEW_SCENARIOS,
  SEND_OFF_CATEGORIES,
} from "@replay/shared-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_MAX = 200;

// 사실 입력
export type FactInput = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  candidateId: string;
  expectedFactRevisionId?: string | null;
  idempotencyKey: string;
  facts: unknown;
}>;

export type FactResult = FactPatchResult | Readonly<{ kind: "INVALID_INPUT"; reason: "ID" | "KEY" | "FACTS" }>;

export type FactDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: EvaluationStore;
}>;

const object = (value: unknown): value is Record<string, unknown> =>
  // 배열이 아닌 객체 확인
  typeof value === "object" && value !== null && !Array.isArray(value);

const one = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  // 허용 목록의 단일 값 확인
  typeof value === "string" && values.includes(value as T);

const observed = (value: unknown, check: (value: unknown) => boolean): boolean => {
  // 관측 사실 객체 확인
  if (!object(value) || !check(value.value) || !one(value.observedAtSpeed, OBSERVATION_SPEEDS)) return false;
  // 관측 사실의 장면 식별자 확인
  return Array.isArray(value.shotIds) && value.shotIds.every((item) => typeof item === "string" && UUID.test(item));
};

const validFacts = (value: unknown): value is EvaluationFacts => {
  // 사실 묶음의 최상위 구조 확인
  if (!object(value) || !object(value.push) || !object(value.variable) || !object(value.observed)) return false;
  const push = value.push;
  const variable = value.variable;
  const decision = value.observed;
  return (
    observed(push.contactDetected, (item) => typeof item === "boolean") &&
    observed(push.severity, (item) => one(item, OBSERVED_SEVERITIES)) &&
    observed(push.opponentDisplacement, (item) => one(item, DISPLACEMENT_LEVELS)) &&
    observed(push.insidePenaltyArea, (item) => typeof item === "boolean") &&
    one(push.cameraSufficiency, CAMERA_SUFFICIENCY_LEVELS) &&
    one(variable.reviewScenario, REVIEW_SCENARIOS) &&
    typeof variable.restartOccurred === "boolean" &&
    one(variable.sendOffCategory, SEND_OFF_CATEGORIES) &&
    typeof variable.mistakenIdentity === "boolean" &&
    one(variable.decisionNature, DECISION_NATURES) &&
    one(variable.errorMagnitude, ERROR_MAGNITUDES) &&
    typeof variable.seriousMissedIncident === "boolean" &&
    one(decision.restartType, RESTART_TYPES) &&
    one(decision.restartBeneficiary, RESTART_BENEFICIARIES) &&
    (decision.card === null || one(decision.card, DISCIPLINARY_ACTIONS)) &&
    one(decision.goalDecision, GOAL_DECISIONS) &&
    one(decision.source, OBSERVED_SOURCES)
  );
};

const ids = (input: FactInput): boolean =>
  [input.anonymousSessionId, input.analysisId, input.candidateId].every((value) => UUID.test(value));

export const facts =
  ({ clock, hasher, repository }: FactDependencies) =>
  async (input: FactInput): Promise<FactResult> => {
    // 입력 식별자 검증
    if (!ids(input)) return { kind: "INVALID_INPUT", reason: "ID" };
    const expected = input.expectedFactRevisionId;
    if (expected !== undefined && expected !== null && (typeof expected !== "string" || !UUID.test(expected))) {
      return { kind: "INVALID_INPUT", reason: "ID" };
    }
    if (typeof input.idempotencyKey !== "string") return { kind: "INVALID_INPUT", reason: "KEY" };
    // 멱등 키 바이트 길이 확인
    const keyBytes = new TextEncoder().encode(input.idempotencyKey);
    if (keyBytes.byteLength === 0 || keyBytes.byteLength > KEY_MAX) {
      return { kind: "INVALID_INPUT", reason: "KEY" };
    }
    if (!validFacts(input.facts)) return { kind: "INVALID_INPUT", reason: "FACTS" };

    // 식별자 소문자 정규화
    const anonymousSessionId = input.anonymousSessionId.toLowerCase();
    const analysisId = input.analysisId.toLowerCase();
    const candidateId = input.candidateId.toLowerCase();
    const expectedFactRevisionId = expected?.toLowerCase() ?? null;
    // 사실 요청 해시 생성
    const requestHash = Uint8Array.from(await hasher.sha256(JSON.stringify({ analysisId, candidateId, facts: input.facts })));
    // 멱등 키 해시 생성
    const keyHash = Uint8Array.from(await hasher.sha256(input.idempotencyKey));
    // 사실 패치 저장
    return repository.patch({
      anonymousSessionId,
      analysisId,
      candidateId,
      expectedFactRevisionId,
      facts: input.facts,
      keyHash,
      requestHash,
      now: clock.now().toISOString(),
    });
  };
