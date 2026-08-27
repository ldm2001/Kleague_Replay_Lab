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

/**
 * 두 어휘가 겹치는 값인지 확인한다.
 *
 * SEND_OFF_CATEGORIES는 8값, VAR_WINDOW_EXCEPTIONS는 5값이고 겹치는 것은
 * 세 가지 퇴장 사안뿐이다. DOGSO나 SECOND_CAUTION은 퇴장 사유이긴 해도
 * 닫힌 검토 창을 다시 열지 않는다. 캐스팅으로 넘기면 판본 데이터가
 * 그런 값을 예외 목록에 넣었을 때 타입도 검사기도 잡지 못한다.
 */
const exception = (
  value: SendOffCategory,
): value is SendOffCategory & VarWindowException =>
  (VAR_WINDOW_EXCEPTIONS as readonly string[]).includes(value);

type CategoryGate = {
  reviewable: boolean;
  category: VarCategory;
  notReviewableReason: VarNotReviewableReason | null;
};

/** 게이트 1 — 판본 데이터에서 조회한다. 오심의 정도는 여기 관여하지 않는다. */
const categoryGate = (
  matched: VarCategoryRule | undefined,
  competitionOptions: CompetitionOptions,
): CategoryGate | { unknownOption: string } => {
  if (!matched) {
    return {
      reviewable: false,
      category: "NONE",
      notReviewableReason: "OUTSIDE_REVIEWABLE_CATEGORIES",
    };
  }

  if (matched.requiresCompetitionOption !== null) {
    const adopted = competitionOptions[matched.requiresCompetitionOption];
    if (adopted === undefined) {
      // 모르는 것을 미채택으로 접지 않는다
      return { unknownOption: matched.requiresCompetitionOption };
    }
    if (!adopted) {
      // 판본에는 있으나 대회가 쓰지 않는다 — category는 그대로 둔다
      return {
        reviewable: false,
        category: matched.id,
        notReviewableReason: "COMPETITION_OPTION_NOT_ADOPTED",
      };
    }
  }

  return { reviewable: true, category: matched.id, notReviewableReason: null };
};

/**
 * 게이트 3 — 네 범주 전부에 같은 문턱이 적용된다.
 *
 * 원문은 두 갈래를 OR로 잇는다:
 *   "clear and obvious error" **or** "serious missed incident"
 * 그래서 미인지 사건은 errorMagnitude의 값이 아니라 별도 입력이고,
 * 오심 정도가 UNDETERMINED여도 미인지가 확인되면 문턱은 넘는다.
 */
const thresholdGate = (facts: VarFacts): VarThresholdResult => {
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

/** 게이트 4 — 문턱과 무관하게 절차만 가른다. */
const procedureGate = (facts: VarFacts, reviewable: boolean): VarReviewProcedure => {
  if (!reviewable) return "NONE";
  return facts.decisionNature === "SUBJECTIVE" ? "OFR" : "VAR_ONLY";
};

export const varResult = (
  facts: VarFacts,
  rules: RuleSet,
  competitionOptions: CompetitionOptions,
): VarOutcome => {
  // 조건을 만족하는 규칙 중 **더 구체적인 것**이 이긴다.
  //
  // `CARD_SHOWN`은 RED_CARD와 MISTAKEN_IDENTITY 양쪽의 appliesTo에 들어 있고,
  // 다른 선수에게 준 카드였다면 후자가 맞다. 데이터를 IFAB 원문 순서
  // (a 득점 · b PK · c 직접 퇴장 · d 선수 확인 오류)대로 두기 위해
  // 순서가 아니라 조건 수로 고른다 — 데이터 순서를 판정 규칙으로 쓰면
  // 판본 파일의 줄 순서가 결과를 바꾼다.
  const candidates = rules
    .varCategories()
    .filter(
      (category) =>
        category.appliesTo.includes(facts.reviewScenario) &&
        (!category.requiresMistakenIdentity || facts.mistakenIdentity),
    );
  const matched =
    candidates.find((category) => category.requiresMistakenIdentity) ?? candidates[0];

  const gate1 = categoryGate(matched, competitionOptions);
  if ("unknownOption" in gate1) {
    return {
      ok: false,
      error: "UNKNOWN_COMPETITION_OPTION",
      message: `대회 채택 여부가 주어지지 않은 옵션: ${gate1.unknownOption}`,
    };
  }

  // 게이트 2 — 검토 창을 닫는 유일한 조건은 재개다.
  //
  // 원문(VAR 1.10 / Law 5.3)의 예외는 선수 확인 오류와 세 가지 퇴장 사안이다.
  // 어느 예외였는지를 접지 않고 그대로 보고한다 — 화면에서
  // "재개 후에도 왜 검토가 가능한가"에 답하는 것이 이 값이다.
  const exceptions = rules.timeWindowExceptions();
  let windowException: VarWindowException = "NONE";
  if (exceptions.mistakenIdentity && facts.mistakenIdentity) {
    windowException = "MISTAKEN_IDENTITY";
  } else if (exceptions.sendOffCategories.includes(facts.sendOffCategory)) {
    // 예외 목록의 값은 그대로 예외 사유가 된다. 변환표를 두지 않는다.
    // 다만 그건 두 어휘가 겹치는 값일 때만 성립한다. 판본 데이터가 겹치지
    // 않는 값을 목록에 넣으면 엔진이 표현할 수 없는 예외를 요구하는 것이고,
    // 그건 사건의 사실값 문제가 아니라 데이터 오류다 — 인용 없는 결과와
    // 같은 부류이므로 같은 방식으로 던진다. enums.mjs가 먼저 잡는다.
    if (!exception(facts.sendOffCategory)) {
      throw new Error(
        `창을 다시 열지 않는 퇴장 사유가 판본의 예외 목록에 있음: ${facts.sendOffCategory} — 규칙 데이터를 확인할 것`,
      );
    }
    windowException = facts.sendOffCategory;
  }
  const withinTimeWindow = !facts.restartOccurred || windowException !== "NONE";

  const thresholdMet = thresholdGate(facts);
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

  // 선후 관계가 나타나는 곳은 여기뿐이다. 네 게이트 값 자체는 위에서 이미 전부 채워졌다.
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
    // 사유를 지어내지 않는다. THRESHOLD_NOT_MET은 확인한 결과이고 이건 확인하지 못한 것이다.
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

  // 대회 채택 옵션은 사건의 사실값이 아니므로 서명에 넣지 않는다.
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
