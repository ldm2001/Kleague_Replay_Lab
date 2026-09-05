import type {
  CompetitionOptions,
  RuleCitation,
  RuleSet,
  VarAssessment,
  VarCategory,
  VarCategoryRule,
  VarFacts,
  VarNotReviewableReason,
  VarOutcome,
  VarReviewProcedure,
  SendOffCategory,
  VarThresholdResult,
  VarWindowException,
} from "@replay/shared-types";
import { VAR_WINDOW_EXCEPTIONS } from "@replay/shared-types";
import { factSignature } from "../signatures/fact-signature";

// 재개 후 예외 어휘 확인
const exception = (
  value: SendOffCategory,
): value is SendOffCategory & VarWindowException =>
  // 재개 후 예외 어휘 확인
  (VAR_WINDOW_EXCEPTIONS as readonly string[]).includes(value);

type CategoryGate = {
  reviewable: boolean;
  category: VarCategory;
  notReviewableReason: VarNotReviewableReason | null;
};

// 범주 게이트
const categoryGate = (
  matched: VarCategoryRule | undefined,
  competitionOptions: CompetitionOptions,
): CategoryGate | { unknownOption: string } => {
  // 검토 범주가 없으면 범위 밖 결과
  if (!matched) {
    return {
      reviewable: false,
      category: "NONE",
      notReviewableReason: "OUTSIDE_REVIEWABLE_CATEGORIES",
    };
  }

  if (matched.requiresCompetitionOption !== null) {
    // 대회별 채택 옵션 조회
    const adopted = competitionOptions[matched.requiresCompetitionOption];
    if (adopted === undefined) {
      // 미확인 옵션 보류
      return { unknownOption: matched.requiresCompetitionOption };
    }
    if (!adopted) {
      // 대회 미채택 범주
      return {
        reviewable: false,
        category: matched.id,
        notReviewableReason: "COMPETITION_OPTION_NOT_ADOPTED",
      };
    }
  }

  return { reviewable: true, category: matched.id, notReviewableReason: null };
};

// 문턱 게이트
const thresholdGate = (facts: VarFacts): VarThresholdResult => {
  // 심각한 누락 사건은 문턱 충족
  if (facts.seriousMissedIncident) return "MET";

  switch (facts.errorMagnitude) {
    case "CLEAR_AND_OBVIOUS":
      return "MET";
    case "NOT_CLEAR_AND_OBVIOUS":
      return "NOT_MET";
    case "UNDETERMINED":
      return "UNDETERMINED";
  }
};

// 절차 게이트
const procedureGate = (facts: VarFacts, reviewable: boolean): VarReviewProcedure => {
  // 검토 범위 밖이면 절차 없음
  if (!reviewable) return "NONE";
  // 주관 판정은 OFR 적용
  return facts.decisionNature === "SUBJECTIVE" ? "OFR" : "VAR_ONLY";
};

export const varResult = (
  facts: VarFacts,
  rules: RuleSet,
  competitionOptions: CompetitionOptions,
): VarOutcome => {
  // 조건 수가 큰 규칙 우선 선택
  const candidates = rules
    .varCategories()
    .filter(
      (category) =>
        category.appliesTo.includes(facts.reviewScenario) &&
        (!category.requiresMistakenIdentity || facts.mistakenIdentity),
    );
  const matched =
    candidates.find((category) => category.requiresMistakenIdentity) ?? candidates[0];

  // 범주 채택 여부 확인
  const gate1 = categoryGate(matched, competitionOptions);
  if ("unknownOption" in gate1) {
    return {
      ok: false,
      error: "UNKNOWN_COMPETITION_OPTION",
      message: `대회 채택 여부가 주어지지 않은 옵션: ${gate1.unknownOption}`,
    };
  }

  // 검토 창과 재개 후 예외
  const exceptions = rules.timeWindowExceptions();
  let windowException: VarWindowException = "NONE";
  if (exceptions.mistakenIdentity && facts.mistakenIdentity) {
    windowException = "MISTAKEN_IDENTITY";
  } else if (exceptions.sendOffCategories.includes(facts.sendOffCategory)) {
    // 예외 어휘 불일치 오류
    if (!exception(facts.sendOffCategory)) {
      throw new Error(
        `창을 다시 열지 않는 퇴장 사유가 판본의 예외 목록에 있음: ${facts.sendOffCategory} — 규칙 데이터를 확인할 것`,
      );
    }
    windowException = facts.sendOffCategory;
  }
  const withinTimeWindow = !facts.restartOccurred || windowException !== "NONE";

  const thresholdMet = thresholdGate(facts);
  // 검토 절차 계산
  const reviewProcedure = procedureGate(facts, gate1.reviewable);

  const assessment: VarAssessment = {
    reviewable: gate1.reviewable,
    category: gate1.category,
    withinTimeWindow,
    thresholdMet,
    reviewProcedure,
    intervention: "NO_INTERVENTION",
    noInterventionReason: null,
    notReviewableReason: gate1.notReviewableReason,
    windowClosedReason: withinTimeWindow ? null : "PLAY_RESTARTED",
    windowException,
    explanation: "",
  };

  // 게이트 결과 우선순위 반영
  if (!gate1.reviewable) {
    assessment.noInterventionReason = "NOT_REVIEWABLE";
    assessment.explanation =
      gate1.notReviewableReason === "COMPETITION_OPTION_NOT_ADOPTED"
        ? "판본에는 있는 범주이나 이 대회가 채택하지 않음"
        : "이 판본의 검토 가능 범주에 해당하지 않음";
  } else if (!withinTimeWindow) {
    assessment.noInterventionReason = "TOO_LATE";
    assessment.explanation = "경기가 재개되어 검토 창이 닫힘";
  } else if (thresholdMet === "NOT_MET") {
    assessment.noInterventionReason = "THRESHOLD_NOT_MET";
    assessment.explanation = "검토 대상에는 해당하나 명백하고 분명한 오류로 보기 어려움";
  } else if (thresholdMet === "UNDETERMINED") {
    // 미확정 문턱 사유
    assessment.explanation = "문턱 판단에 필요한 사실값이 확정되지 않아 개입 여부를 말할 수 없음";
  } else {
    assessment.intervention = "OVERTURNED";
    assessment.explanation = "명백하고 분명한 오류에 해당해 원심이 변경될 사안";
  }

  const citations: RuleCitation[] = [
    ...rules.cite("VAR_REVIEWABLE_CATEGORIES"),
    ...rules.cite("VAR_TIME_WINDOW"),
    ...rules.cite("VAR_THRESHOLD"),
    ...rules.cite("VAR_REVIEW_PROCESS"),
  ];

  if (citations.length === 0) {
    throw new Error("varResult가 인용 없이 결과를 만들려 했음 — 규칙 데이터를 확인할 것");
  }

  // 대회 옵션은 사실 서명에서 제외
  const { signature, input } = factSignature({
    reviewScenario: facts.reviewScenario,
    restartOccurred: facts.restartOccurred,
    sendOffCategory: facts.sendOffCategory,
    mistakenIdentity: facts.mistakenIdentity,
    decisionNature: facts.decisionNature,
    errorMagnitude: facts.errorMagnitude,
    seriousMissedIncident: facts.seriousMissedIncident,
  });

  return { ok: true, assessment, citations, factSignature: signature, factSignatureInput: input };
};
