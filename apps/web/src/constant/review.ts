import type { EvaluationFacts } from "@replay/shared-types";

// 사실 확인 입력의 어휘와 화면 문구
export const reviewFields = [
  { name: "contact", label: "선수 사이 접촉", group: "영상 사실", options: [["true", "접촉 확인"], ["false", "접촉 없음 확인"]] },
  { name: "severity", label: "정상 속도에서 본 강도", group: "영상 사실", options: [["uncertain", "판단 어려움"], ["CARELESS", "부주의"], ["RECKLESS", "무모한 동작"], ["EXCESSIVE_FORCE", "과도한 힘"]] },
  { name: "displacement", label: "상대 선수의 밀림", group: "영상 사실", options: [["uncertain", "판단 어려움"], ["possible", "밀림 가능성"], ["clear", "명확한 밀림"], ["none", "밀림 없음"]] },
  { name: "penalty", label: "페널티 구역 안 접촉", group: "영상 사실", options: [["true", "구역 안 확인"], ["false", "구역 밖 확인"]] },
  { name: "camera", label: "카메라 근거", group: "영상 사실", options: [["LOW", "가림 또는 각도 부족"], ["MEDIUM", "일부 확인 가능"], ["HIGH", "동작 충분히 확인"]] },
  { name: "speed", label: "중계 영상의 관측 속도", group: "영상 사실", options: [["UNKNOWN", "속도 미확인"], ["NORMAL", "정상 속도 확인"], ["SLOW", "슬로모션만 확인"]] },
  { name: "scenario", label: "중계에서 확인한 상황", group: "VAR 조건", options: [["GOAL_DISALLOWED", "득점 취소"], ["GOAL_AWARDED", "득점 인정"], ["PENALTY_NOT_GIVEN", "페널티 미선언"], ["PENALTY_GIVEN", "페널티 선언"], ["SENDING_OFF_NOT_GIVEN", "퇴장 미선언"], ["CARD_SHOWN", "카드 제시"], ["SECOND_CAUTION", "두 번째 경고"], ["OTHER", "그 밖의 상황 확인"]] },
  { name: "restart", label: "경기 재개 여부", group: "VAR 조건", options: [["true", "이미 재개"], ["false", "재개 전 확인"]] },
  { name: "dismissal", label: "퇴장 사유", group: "VAR 조건", options: [["NONE", "퇴장 사안 아님"], ["DOGSO", "명백한 득점 기회 저지"], ["SERIOUS_FOUL_PLAY", "심한 반칙"], ["VIOLENT_CONDUCT", "폭력 행위"], ["BITING_OR_SPITTING", "물기 또는 침 뱉기"], ["OFFENSIVE_LANGUAGE_OR_ACTION", "모욕적 언행"], ["SECOND_CAUTION", "두 번째 경고"]] },
  { name: "identity", label: "카드 대상 선수 착오", group: "VAR 조건", options: [["false", "착오 없음 확인"], ["true", "착오 확인"]] },
  { name: "nature", label: "검토할 판정의 성격", group: "VAR 조건", options: [["SUBJECTIVE", "접촉 강도 등 해석 필요"], ["FACTUAL", "위치 등 사실 확인"]] },
  { name: "error", label: "명백한 오류 여부", group: "VAR 조건", options: [["UNDETERMINED", "판단 보류"], ["CLEAR_AND_OBVIOUS", "명백한 오류 확인"], ["NOT_CLEAR_AND_OBVIOUS", "명백한 오류로 보기 어려움"]] },
  { name: "missed", label: "심각한 사건의 누락", group: "VAR 조건", options: [["false", "누락 없음 확인"], ["true", "누락 확인"]] },
  { name: "observedRestart", label: "관측된 경기 재개", group: "관측 판정", options: [["UNKNOWN", "재개 방식 미확인"], ["PLAY_CONTINUED", "경기 속행"], ["DIRECT_FREE_KICK", "직접 프리킥"], ["INDIRECT_FREE_KICK", "간접 프리킥"], ["PENALTY_KICK", "페널티킥"], ["DROP_BALL", "드롭볼"], ["THROW_IN", "스로인"], ["GOAL_KICK", "골킥"], ["CORNER_KICK", "코너킥"], ["KICK_OFF", "킥오프"]] },
  { name: "beneficiary", label: "재개 혜택 팀", group: "관측 판정", options: [["UNKNOWN", "대상 미확인"], ["ATTACKING_TEAM", "공격 팀"], ["DEFENDING_TEAM", "수비 팀"], ["NONE", "해당 없음"]] },
  { name: "observedCard", label: "관측된 카드", group: "관측 판정", options: [["null", "카드 미확인"], ["NONE", "카드 없음 확인"], ["CAUTION", "경고"], ["SECOND_CAUTION", "두 번째 경고"], ["SEND_OFF", "퇴장"]] },
  { name: "observedGoal", label: "관측된 득점 판정", group: "관측 판정", options: [["UNKNOWN", "득점 판정 미확인"], ["GOAL", "득점 인정"], ["NO_GOAL", "득점 불인정"], ["NOT_APPLICABLE", "득점 상황 아님"]] },
  { name: "observedSource", label: "관측 판정 출처", group: "관측 판정", options: [["USER_INPUT", "사용자 영상 확인"], ["RESTART_INFERRED", "재개 방식에서 확인"], ["REFEREE_SIGNAL", "주심 신호에서 확인"], ["VAR_OFR", "VAR 또는 OFR에서 확인"], ["MATCH_REPORT", "경기 보고서에서 확인"]] },
] as const;

// 서버에 저장된 사실을 폼 선택값으로 복원
export const reviewValues = (facts: EvaluationFacts | null | undefined): Record<string, string> => {
  // 최초 검토는 추정 기본값 없이 시작
  if (!facts) return {};
  // 영상 사실과 VAR 조건 참조
  const { push, variable } = facts;
  // 화면별 선택값 구성
  return { contact: String(push.contactDetected.value), severity: push.severity.value,
    displacement: push.opponentDisplacement.value, penalty: String(push.insidePenaltyArea.value),
    camera: push.cameraSufficiency, speed: push.severity.observedAtSpeed,
    scenario: variable.reviewScenario, restart: String(variable.restartOccurred), dismissal: variable.sendOffCategory,
    identity: String(variable.mistakenIdentity), nature: variable.decisionNature,
    error: variable.errorMagnitude, missed: String(variable.seriousMissedIncident),
    observedRestart: facts.observed.restartType, beneficiary: facts.observed.restartBeneficiary,
    observedCard: facts.observed.card ?? "null", observedGoal: facts.observed.goalDecision,
    observedSource: facts.observed.source };
};

// 허용된 선택과 실제 영상 샷을 평가 사실로 변환
export const reviewFacts = (values: Record<string, string>, shots: string[]): EvaluationFacts | null => {
  // 빈 선택과 변조된 어휘 및 근거 없는 제출 차단
  if (shots.length === 0 || reviewFields.some((field) => !field.options.some(([key]) => key === values[field.name]))) return null;
  // 관측 속도와 실제 근거 샷 연결
  const observedAtSpeed = values.speed as EvaluationFacts["push"]["severity"]["observedAtSpeed"];
  // 사용자 확인 사실 구성
  return {
    push: {
      contactDetected: { value: values.contact === "true", observedAtSpeed, shotIds: shots },
      severity: { value: values.severity as EvaluationFacts["push"]["severity"]["value"], observedAtSpeed, shotIds: shots },
      opponentDisplacement: { value: values.displacement as EvaluationFacts["push"]["opponentDisplacement"]["value"], observedAtSpeed, shotIds: shots },
      insidePenaltyArea: { value: values.penalty === "true", observedAtSpeed, shotIds: shots },
      cameraSufficiency: values.camera as EvaluationFacts["push"]["cameraSufficiency"],
    },
    variable: {
      reviewScenario: values.scenario as EvaluationFacts["variable"]["reviewScenario"],
      restartOccurred: values.restart === "true",
      sendOffCategory: values.dismissal as EvaluationFacts["variable"]["sendOffCategory"],
      mistakenIdentity: values.identity === "true",
      decisionNature: values.nature as EvaluationFacts["variable"]["decisionNature"],
      errorMagnitude: values.error as EvaluationFacts["variable"]["errorMagnitude"],
      seriousMissedIncident: values.missed === "true",
    },
    // 화면에서 확인한 원심 판정과 출처 보존
    observed: {
      restartType: values.observedRestart as EvaluationFacts["observed"]["restartType"],
      restartBeneficiary: values.beneficiary as EvaluationFacts["observed"]["restartBeneficiary"],
      card: values.observedCard === "null" ? null : values.observedCard as EvaluationFacts["observed"]["card"],
      goalDecision: values.observedGoal as EvaluationFacts["observed"]["goalDecision"],
      source: values.observedSource as EvaluationFacts["observed"]["source"],
    },
  };
};
