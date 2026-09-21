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

  // 과거 입력이나 미확인 관측을 적용 맥락으로 추정하지 않는다.
  const context = facts.context;
  if (typeof facts.contactDetected.value !== "boolean" ||
      typeof facts.insidePenaltyArea.value !== "boolean" || !context ||
      typeof context.ballInPlay?.value !== "boolean" ||
      typeof context.onField?.value !== "boolean" ||
      typeof context.againstOpponent?.value !== "boolean" ||
      typeof context.insideOwnPenaltyArea?.value !== "boolean" ||
      !["ATTACKING_TEAM", "DEFENDING_TEAM"].includes(context.offenderRole?.value) ||
      !["NONE", "DOGSO", "SPA"].includes(context.disciplinaryContext?.value)) {
    return inconclusive("FACTS_UNDETERMINED", [...offence, ...disciplineCitations]);
  }
  if (!context.ballInPlay.value || !context.onField.value || !context.againstOpponent.value ||
      context.disciplinaryContext.value !== "NONE" ||
      (context.insideOwnPenaltyArea.value && !facts.insidePenaltyArea.value)) {
    return inconclusive("CONTEXT_UNSUPPORTED", [...offence, ...disciplineCitations]);
  }

  // 확인된 접촉 없음만 밀기 반칙 없음으로 처리한다.
  if (facts.contactDetected.value === false) {
    return {
      decision: "NO_FOUL",
      severity: null,
      restart: "PLAY_CONTINUED",
      disciplinary: "NONE",
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

  // 파울과 재개와 징계 판정
  return {
    decision: "FOUL",
    severity,
    restart: context.insideOwnPenaltyArea.value ? "PENALTY_KICK" : "DIRECT_FREE_KICK",
    disciplinary: discipline(severity),
    confidence: confidence(facts),
    inconclusiveReason: null,
    citations: [...offence, ...disciplineCitations],
  };
};
