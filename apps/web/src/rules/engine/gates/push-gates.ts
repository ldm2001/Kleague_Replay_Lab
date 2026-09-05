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
  // 강도별 징계 수준 선택
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
  // 카메라 충족도 기준 확신도 계산
  facts.cameraSufficiency === "HIGH" ? "HIGH" : "MEDIUM";

const inconclusive = (
  reason: InconclusiveReason,
  citations: RuleCitation[],
): PushVerdict => ({
  // 판정 보류 결과 구성
  decision: "INCONCLUSIVE",
  severity: null,
  restart: null,
  disciplinary: null,
  confidence: "LOW",
  inconclusiveReason: reason,
  citations,
});

// 판정 필드만 결정하는 게이트
export const pushGates = (facts: PushFacts, rules: RuleSet): PushVerdict => {
  // 밀기 관련 조항 묶음 조회
  const offence = rules.cite("LAW_12_DIRECT_FREE_KICK");
  const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
  const reviewProcess = rules.cite("VAR_REVIEW_PROCESS");

  // 각도 게이트
  if (facts.cameraSufficiency === "LOW") {
    return inconclusive("CAMERA_INSUFFICIENT", offence);
  }

  // 접촉 없음 판정
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

  // 속도 게이트
  if (facts.severity.observedAtSpeed !== "NORMAL") {
    return inconclusive("SLOW_MOTION_ONLY", [...offence, ...reviewProcess]);
  }

  // 강도와 밀림 불확정 보류
  if (
    facts.severity.value === "uncertain" ||
    facts.opponentDisplacement.value === "uncertain" ||
    facts.opponentDisplacement.value === "possible"
  ) {
    return inconclusive("SEVERITY_UNDETERMINED", [...offence, ...disciplineCitations]);
  }

  const severity = facts.severity.value;

  // 부주의 접촉 판정
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

  // 파울과 재개와 징계 판정
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
