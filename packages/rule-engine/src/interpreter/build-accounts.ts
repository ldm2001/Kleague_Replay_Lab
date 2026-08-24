import type {
  AuthorityAccount,
  FactBlocker,
  FactRequirement,
  LayerConflict,
  Observed,
  PushFacts,
  RuleCitation,
  RuleSet,
} from "@replay/shared-types";

export type PushAccountView = {
  accounts: AuthorityAccount[];
  conflicts: LayerConflict[];
  narrowedTo: RuleCitation[];
  blockedFrom: FactRequirement[];
};

/**
 * 규정 질문에 답하지 못하는 표시값.
 *   uncertain — 관측했으나 값을 특정하지 못함
 *   possible  — 값은 정해졌으나 "밀렸는가"라는 규정 질문에는 답하지 않음
 *
 * 게이트 4가 둘을 같이 보류로 다룬다. 요구사항 판정이 여기서 갈라지면
 * decision은 INCONCLUSIVE인데 blockedFrom은 빈 상태가 만들어지고,
 * 사용자는 이유가 붙지 않은 '판정 불가'만 보게 된다 (push-10이 검사한다).
 */
const UNRESOLVED_VALUES: ReadonlySet<unknown> = new Set(["uncertain", "possible"]);

/**
 * 사실값 하나가 선 상태인지 판정한다.
 *
 * 세 가지를 구분한다.
 *   CAMERA — 각도가 부족해 관측 자체를 신뢰할 수 없음
 *   SPEED  — 정상 속도 관측이 없어 강도값을 입력으로 승인할 수 없음
 *   null   — 관측은 됐으나 그 값이 규정 질문에 답하지 못함
 * 셋을 합치면 사용자가 다음에 무엇을 해야 하는지가 사라진다.
 */
const requirement = (
  fact: string,
  observation: Observed<unknown>,
  options: { cameraSufficiency: PushFacts["cameraSufficiency"]; needsNormalSpeed: boolean },
  narrowsTo: RuleCitation | null,
): FactRequirement => {
  let blockedBy: FactBlocker | null = null;
  let established = true;

  if (options.cameraSufficiency === "LOW") {
    blockedBy = "CAMERA";
    established = false;
  } else if (options.needsNormalSpeed && observation.observedAtSpeed !== "NORMAL") {
    blockedBy = "SPEED";
    established = false;
  } else if (UNRESOLVED_VALUES.has(observation.value)) {
    established = false;
  }

  return {
    fact,
    status: established ? "ESTABLISHED" : "UNMET",
    blockedBy,
    narrowsTo,
  };
};

/**
 * 규정이 이 상황에 대해 말하는 것을 먼저 만든다.
 * 게이트는 이 결과를 지우지 않고 decision 계열 필드만 정한다.
 */
export const buildPushAccounts = (facts: PushFacts, rules: RuleSet): PushAccountView => {
  const offenceCitations = rules.cite("LAW_12_DIRECT_FREE_KICK");
  const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
  const speedCitations = rules.cite("VAR_REVIEW_PROCESS");
  const disciplineEntry = disciplineCitations[0] ?? null;

  const camera = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: false };
  const cameraAndSpeed = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: true };

  const requires: FactRequirement[] = [
    requirement("contactDetected", facts.contactDetected, camera, offenceCitations[0] ?? null),
    // 강도만 정상 속도를 요구한다 — VAR 프로토콜이 'intensity'에 normal speed를 요구하기 때문
    requirement("severity", facts.severity, cameraAndSpeed, disciplineEntry),
    requirement("opponentDisplacement", facts.opponentDisplacement, camera, disciplineEntry),
    requirement("insidePenaltyArea", facts.insidePenaltyArea, camera, offenceCitations[0] ?? null),
  ];

  const blockedFrom = requires.filter((entry) => entry.status === "UNMET");
  const severityEstablished =
    requires.find((entry) => entry.fact === "severity")?.status === "ESTABLISHED";

  const narrowedTo: RuleCitation[] = [...offenceCitations];
  if (severityEstablished) {
    narrowedTo.push(...disciplineCitations);
  } else if (facts.severity.observedAtSpeed !== "NORMAL" && facts.cameraSufficiency !== "LOW") {
    // 속도 게이트에 걸렸다는 사실 자체의 근거를 남긴다
    narrowedTo.push(...speedCitations.filter((citation) => citation.relevance === "PRIMARY"));
  }

  const accounts: AuthorityAccount[] = offenceCitations[0]
    ? [
        {
          authority: offenceCitations[0].authority,
          edition: offenceCitations[0].edition,
          citations: [...offenceCitations, ...disciplineCitations],
          requires,
        },
      ]
    : [];

  return { accounts, conflicts: [...rules.layerConflicts()], narrowedTo, blockedFrom };
};
