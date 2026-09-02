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

// 규정 질문에 답하지 못하는 값
const UNRESOLVED_VALUES: ReadonlySet<unknown> = new Set(["uncertain", "possible"]);

// 사실값별 차단 사유
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

// 규정 요구사항과 차단 사실
export const pushAccounts = (facts: PushFacts, rules: RuleSet): PushAccountView => {
  const offenceCitations = rules.cite("LAW_12_DIRECT_FREE_KICK");
  const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
  const speedCitations = rules.cite("VAR_REVIEW_PROCESS");
  const disciplineEntry = disciplineCitations[0] ?? null;

  const camera = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: false };
  const cameraAndSpeed = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: true };

  const requires: FactRequirement[] = [
    requirement("contactDetected", facts.contactDetected, camera, offenceCitations[0] ?? null),
    // 강도는 정상 속도 관측 필요
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
    // 속도 차단 근거 추가
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
