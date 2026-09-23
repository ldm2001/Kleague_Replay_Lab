// 공통 관측과 판정 자료형 가져오기
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
    VarWindowException
} from "@replay/shared-types";
// 공통 관측과 판정 자료형 가져오기
import { VAR_WINDOW_EXCEPTIONS } from "@replay/shared-types";
// 사실 내용 해시 기능 가져오기
import { factSignature } from "../signatures/fact-signature";

// 재개 후 예외 어휘 확인
const exception = (
    value: SendOffCategory,
): value is SendOffCategory & VarWindowException =>
    // 재개 후 예외 어휘 확인
    (VAR_WINDOW_EXCEPTIONS as readonly string[]).includes(value);

// 검토 범주 통과 여부의 자료 구조 정의
type CategoryGate = {
    // 비디오 판독 검토 대상 여부
    reviewable: boolean;
    // 현재 검토 범주
    category: VarCategory;
    // 검토 대상이 아닌 이유
    notReviewableReason: VarNotReviewableReason | null;
};

// 범주 게이트
const categoryGate = (
    matched: VarCategoryRule | undefined,
    competitionOptions: CompetitionOptions,
): CategoryGate | { unknownOption: string } => {
    // 검토 범주가 없으면 범위 밖 결과
    if (!matched) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            // 비디오 판독 검토 대상 여부 기록
            reviewable: false,
            // 현재 검토 범주 기록
            category: "NONE",
            // 검토 대상이 아닌 이유 기록
            notReviewableReason: "OUTSIDE_REVIEWABLE_CATEGORIES",
        };
    }

    // 대회별 선택 규정 확인 필요 여부의 조건에 따라 처리 분기
    if (matched.requiresCompetitionOption !== null) {
        // 대회별 채택 옵션 조회
        const adopted = competitionOptions[matched.requiresCompetitionOption];
        // 대회의 선택 규정 채택 여부의 조건에 따라 처리 분기
        if (adopted === undefined) {
            // 미확인 옵션 보류
            return { unknownOption: matched.requiresCompetitionOption };
        }
        // 대회의 선택 규정 채택 여부의 조건에 따라 처리 분기
        if (!adopted) {
            // 대회 미채택 범주
            return {
                // 비디오 판독 검토 대상 여부 기록
                reviewable: false,
                // 현재 검토 범주 기록
                category: matched.id,
                // 검토 대상이 아닌 이유 기록
                notReviewableReason: "COMPETITION_OPTION_NOT_ADOPTED",
            };
        }
    }

    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return { reviewable: true, category: matched.id, notReviewableReason: null };
};

// 문턱 게이트
const thresholdGate = (facts: VarFacts): VarThresholdResult => {
    // 심각한 누락 사건은 문턱 충족
    if (facts.seriousMissedIncident) return "MET";

    // 원심 오류의 명확성 수준별 처리 경로 선택
    switch (facts.errorMagnitude) {
        case "CLEAR_AND_OBVIOUS":
            // 개입 기준 충족 결과 반환
            return "MET";
        case "NOT_CLEAR_AND_OBVIOUS":
            // 개입 기준 미충족 결과 반환
            return "NOT_MET";
        case "UNDETERMINED":
            // 개입 기준 미확인 결과 반환
            return "UNDETERMINED";
    }
};

// 절차 게이트
const procedureGate = (facts: VarFacts, reviewable: boolean): VarReviewProcedure => {
    // 검토 범위 밖이면 절차 없음
    if (!reviewable) return "NONE";
    // 주관 판정은 주심 현장 검토 적용
    return facts.decisionNature === "SUBJECTIVE" ? "OFR" : "VAR_ONLY";
};

// 결과 처리
export const varResult = (
    facts: VarFacts,
    rules: RuleSet,
    competitionOptions: CompetitionOptions,
): VarOutcome => {
    // 충족되지 않은 입력 목록 선별
    const missing = (["restartOccurred", "mistakenIdentity", "seriousMissedIncident"] as const)
        .filter((field) => typeof facts[field] !== "boolean");
    // 충족되지 않은 입력 목록의 조건에 따라 처리 분기
    if (missing.length > 0) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            // 검사 조건 충족 여부 기록
            ok: false,
            // 처리 중 발생한 오류 기록
            error: "INSUFFICIENT_FACTS",
            // 결과 또는 오류 설명 기록
            message: `VAR 평가에 필요한 사실이 미확인 상태임: ${missing.join(", ")}`,
        };
    }
    // 조건 수가 큰 규칙 우선 선택
    const candidates = rules
        .varCategories()
        .filter(
            (category) =>
                category.appliesTo.includes(facts.reviewScenario) &&
                (!category.requiresMistakenIdentity || facts.mistakenIdentity),
        );
    // 조건에 맞는 규정 범주 조회
    const matched =
        candidates.find((category) => category.requiresMistakenIdentity) ?? candidates[0];

    // 범주 채택 여부 확인
    const gate1 = categoryGate(matched, competitionOptions);
    // 검토 범주 단계의 결과의 조건에 따라 처리 분기
    if ("unknownOption" in gate1) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            // 검사 조건 충족 여부 기록
            ok: false,
            // 처리 중 발생한 오류 기록
            error: "UNKNOWN_COMPETITION_OPTION",
            // 결과 또는 오류 설명 기록
            message: `대회 채택 여부가 주어지지 않은 옵션: ${gate1.unknownOption}`,
        };
    }

    // 검토 창과 재개 후 예외
    const exceptions = rules.timeWindowExceptions();
    // 재개 이후에도 검토 가능한 예외 계산
    let windowException: VarWindowException = "NONE";
    // 선수 신원 오인 여부의 조건에 따라 처리 분기
    if (exceptions.mistakenIdentity && facts.mistakenIdentity) {
        // 재개 이후에도 검토 가능한 예외 갱신
        windowException = "MISTAKEN_IDENTITY";
    } else if (exceptions.sendOffCategories.includes(facts.sendOffCategory)) {
        // 예외 어휘 불일치 오류
        if (!exception(facts.sendOffCategory)) {
            // 입력 또는 실행 조건을 만족하지 못해 오류 전달
            throw new Error(
                `창을 다시 열지 않는 퇴장 사유가 판본의 예외 목록에 있음: ${facts.sendOffCategory} — 규칙 데이터를 확인할 것`,
            );
        }
        // 재개 이후에도 검토 가능한 예외 갱신
        windowException = facts.sendOffCategory;
    }
    // 검토 가능한 시간 안인지 여부 계산
    const withinTimeWindow = !facts.restartOccurred || windowException !== "NONE";

    // 검토 개입 기준 충족 여부 확인
    const thresholdMet = thresholdGate(facts);
    // 검토 절차 계산
    const reviewProcedure = procedureGate(facts, gate1.reviewable);

    // 규정 평가 결과 구성
    const assessment: VarAssessment = {
        // 비디오 판독 검토 대상 여부 기록
        reviewable: gate1.reviewable,
        // 현재 검토 범주 기록
        category: gate1.category,
        // 검토 가능한 시간 안인지 여부 기록
        withinTimeWindow,
        // 검토 개입 기준 충족 여부 기록
        thresholdMet,
        // 선택한 비디오 판독 검토 절차 기록
        reviewProcedure,
        // 비디오 판독 개입 결과 기록
        intervention: "NO_INTERVENTION",
        // 개입하지 않는 이유 기록
        noInterventionReason: null,
        // 검토 대상이 아닌 이유 기록
        notReviewableReason: gate1.notReviewableReason,
        // 검토 가능 시간 종료 이유 기록
        windowClosedReason: withinTimeWindow ? null : "PLAY_RESTARTED",
        // 재개 이후에도 검토 가능한 예외 기록
        windowException,
        // 결과를 설명하는 내용 기록
        explanation: "",
    };

    // 게이트 결과 우선순위 반영
    if (!gate1.reviewable) {
        // 개입하지 않는 이유 갱신
        assessment.noInterventionReason = "NOT_REVIEWABLE";
        // 결과를 설명하는 내용 갱신
        assessment.explanation =
            gate1.notReviewableReason === "COMPETITION_OPTION_NOT_ADOPTED"
                ? "판본에는 있는 범주이나 이 대회가 채택하지 않음"
                : "이 판본의 검토 가능 범주에 해당하지 않음";
    } else if (!withinTimeWindow) {
        // 개입하지 않는 이유 갱신
        assessment.noInterventionReason = "TOO_LATE";
        // 결과를 설명하는 내용 갱신
        assessment.explanation = "경기가 재개되어 검토 창이 닫힘";
    } else if (thresholdMet === "NOT_MET") {
        // 개입하지 않는 이유 갱신
        assessment.noInterventionReason = "THRESHOLD_NOT_MET";
        // 결과를 설명하는 내용 갱신
        assessment.explanation = "검토 대상에는 해당하나 명백하고 분명한 오류로 보기 어려움";
    } else if (thresholdMet === "UNDETERMINED") {
        // 비디오 판독 개입 결과 갱신
        assessment.intervention = "UNDETERMINED";
        // 미확정 문턱 사유
        assessment.explanation = "문턱 판단에 필요한 사실값이 확정되지 않아 개입 여부를 말할 수 없음";
    } else {
        // 비디오 판독 개입 결과 갱신
        assessment.intervention = "INTERVENTION_RECOMMENDED";
        // 결과를 설명하는 내용 갱신
        assessment.explanation = "규정상 VAR 개입 요건을 충족함. 실제 개입이나 원심 변경을 관측한 결과는 아님";
    }

    // 결론에 연결된 규정 인용 구성
    const citations: RuleCitation[] = [
        ...rules.cite("VAR_REVIEWABLE_CATEGORIES"),
        ...rules.cite("VAR_TIME_WINDOW"),
        ...rules.cite("VAR_THRESHOLD"),
        ...rules.cite("VAR_REVIEW_PROCESS"),
    ];

    // 결론에 연결된 규정 인용의 조건에 따라 처리 분기
    if (citations.length === 0) {
        // 입력 또는 실행 조건을 만족하지 못해 오류 전달
        throw new Error("varResult가 인용 없이 결과를 만들려 했음 — 규칙 데이터를 확인할 것");
    }

    // 대회 옵션은 사실 서명에서 제외
    const { signature, input } = factSignature({
        // 검토를 요청한 상황 기록
        reviewScenario: facts.reviewScenario,
        // 실제 경기 재개가 관측됐는지 여부 기록
        restartOccurred: facts.restartOccurred,
        // 현재 퇴장 검토 범주 기록
        sendOffCategory: facts.sendOffCategory,
        // 선수 신원 오인 여부 기록
        mistakenIdentity: facts.mistakenIdentity,
        // 사실 판정과 주관 평가의 구분 기록
        decisionNature: facts.decisionNature,
        // 원심 오류의 명확성 수준 기록
        errorMagnitude: facts.errorMagnitude,
        // 중대한 사건 누락 여부 기록
        seriousMissedIncident: facts.seriousMissedIncident,
    });

    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return { ok: true, assessment, citations, factSignature: signature, factSignatureInput: input };
};
