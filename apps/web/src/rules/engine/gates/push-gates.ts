import type {
  ConfidenceLevel,
  Decision,
  DisciplinaryAction,
  InconclusiveReason,
  PushFacts,
  RestartType,
  RuleCitation,
  RuleSet,
  Severity,
} from "@replay/shared-types";

export type PushVerdict = {
  decision: Decision;
  severity: Severity | null;
  restart: RestartType | null;
  disciplinary: DisciplinaryAction | null;
  confidence: ConfidenceLevel;
  inconclusiveReason: InconclusiveReason | null;
  citations: RuleCitation[];
};

export const discipline = (severity: Severity): DisciplinaryAction => {
  switch (severity) {
    case "CARELESS":
      return "NONE";
    case "RECKLESS":
      return "CAUTION";
    case "EXCESSIVE_FORCE":
      return "SEND_OFF";
  }
};

const confidence = (facts: PushFacts): ConfidenceLevel =>
  facts.cameraSufficiency === "HIGH" ? "HIGH" : "MEDIUM";

const inconclusive = (
  reason: InconclusiveReason,
  citations: RuleCitation[],
): PushVerdict => ({
  decision: "INCONCLUSIVE",
  severity: null,
  restart: null,
  disciplinary: null,
  confidence: "LOW",
  inconclusiveReason: reason,
  citations,
});

/**
 * 게이트는 decision 계열 필드만 정한다.
 * accounts와 narrowedTo는 pushAccounts가 이미 만들어 두었고 여기서 지우지 않는다.
 */
export const pushGates = (facts: PushFacts, rules: RuleSet): PushVerdict => {
  const offence = rules.cite("LAW_12_DIRECT_FREE_KICK");
  const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
  const reviewProcess = rules.cite("VAR_REVIEW_PROCESS");

  // 1 각도 게이트 — 근거가 부족하면 판정하지 않는다
  if (facts.cameraSufficiency === "LOW") {
    return inconclusive("CAMERA_INSUFFICIENT", offence);
  }

  // 2 접촉 없음 — 슬로우모션 관측으로 충분하다 (원문이 point of contact를 사실 범주로 둔다)
  if (!facts.contactDetected.value) {
    return {
      decision: "NO_FOUL",
      severity: null,
      restart: "PLAY_CONTINUED",
      disciplinary: null,
      confidence: confidence(facts),
      inconclusiveReason: null,
      citations: offence,
    };
  }

  // 3 속도 게이트 — 강도는 정상 속도 관측 없이 판정 입력으로 승인하지 않는다
  if (facts.severity.observedAtSpeed !== "NORMAL") {
    return inconclusive("SLOW_MOTION_ONLY", [...offence, ...reviewProcess]);
  }

  // 4 강도나 밀림을 특정할 수 없으면 보류한다. possible은 파울이 아니라 보류다
  if (
    facts.severity.value === "uncertain" ||
    facts.opponentDisplacement.value === "uncertain" ||
    facts.opponentDisplacement.value === "possible"
  ) {
    return inconclusive("SEVERITY_UNDETERMINED", [...offence, ...disciplineCitations]);
  }

  const severity = facts.severity.value;

  // 5 접촉은 있으나 밀림이 없고 부주의 수준이면 반칙이 아니다
  if (facts.opponentDisplacement.value === "none" && severity === "CARELESS") {
    return {
      decision: "NORMAL_CONTACT",
      severity: null,
      restart: "PLAY_CONTINUED",
      disciplinary: "NONE",
      confidence: confidence(facts),
      inconclusiveReason: null,
      citations: [...offence, ...disciplineCitations],
    };
  }

  // 6 파울 — 재개는 지역이, 징계는 강도가 정한다
  return {
    decision: "FOUL",
    severity,
    restart: facts.insidePenaltyArea.value ? "PENALTY_KICK" : "DIRECT_FREE_KICK",
    disciplinary: discipline(severity),
    confidence: confidence(facts),
    inconclusiveReason: null,
    citations: [...offence, ...disciplineCitations],
  };
};
