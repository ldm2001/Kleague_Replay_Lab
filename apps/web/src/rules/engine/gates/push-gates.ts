// 공통 관측과 판정 자료형 가져오기
import type {
    ConfidenceLevel,
    Decision,
    DisciplinaryAction,
    InconclusiveReason,
    PushFacts,
    RestartType,
    RuleCitation,
    RuleSet,
    Severity
} from "@replay/shared-types";

// 밀기 성립과 후속 결과의 자료 구조 정의
export type PushVerdict = {
    // 규정 대조로 계산한 판정
    decision: Decision;
    // 행위 강도 평가
    severity: Severity | null;
    // 경기 재개에 관한 결과
    restart: RestartType | null;
    // 징계에 관한 독립 결과
    disciplinary: DisciplinaryAction | null;
    // 카메라 근거 충분성에서 계산한 평가 신뢰 수준
    confidence: ConfidenceLevel;
    // 판정을 확정하지 못한 이유
    inconclusiveReason: InconclusiveReason | null;
    // 결론에 연결된 규정 인용
    citations: RuleCitation[];
};

// 행위 강도에 따른 기본 징계 선택
export const discipline = (severity: Severity): DisciplinaryAction => {
    // 강도별 징계 수준 선택
    switch (severity) {
        case "CARELESS":
            // 추가 카드 없음 결과 반환
            return "NONE";
        case "RECKLESS":
            // 경고 결과 반환
            return "CAUTION";
        case "EXCESSIVE_FORCE":
            // 퇴장 결과 반환
            return "SEND_OFF";
    }
};

// 카메라 충분성에 따른 신뢰 수준 선택
const confidence = (facts: PushFacts): ConfidenceLevel =>
    // 카메라 충족도 기준 확신도 계산
    facts.cameraSufficiency === "HIGH" ? "HIGH" : "MEDIUM";

// 판정 불가 결과와 사유 구성
const inconclusive = (
    reason: InconclusiveReason,
    citations: RuleCitation[],
): PushVerdict => ({
    // 판정 보류 결과 구성
    decision: "INCONCLUSIVE",
    // 행위 강도 평가 기록
    severity: null,
    // 경기 재개에 관한 결과 기록
    restart: null,
    // 징계에 관한 독립 결과 기록
    disciplinary: null,
    // 카메라 근거 충분성에서 계산한 평가 신뢰 수준 기록
    confidence: "LOW",
    // 판정을 확정하지 못한 이유 기록
    inconclusiveReason: reason,
    // 결론에 연결된 규정 인용 기록
    citations,
});

// 판정 필드만 결정하는 게이트
export const pushGates = (facts: PushFacts, rules: RuleSet): PushVerdict => {
    // 밀기 관련 조항 묶음 조회
    const offence = rules.cite("LAW_12_DIRECT_FREE_KICK");
    // 징계 구분을 설명하는 규정 인용 확인
    const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
    // 비디오 판독 절차의 규정 인용 확인
    const reviewProcess = rules.cite("VAR_REVIEW_PROCESS");

    // 각도 게이트
    if (facts.cameraSufficiency === "LOW") {
        // 해당 유형의 반칙 성립 결론를 반영한 결과 반환
        return inconclusive("CAMERA_INSUFFICIENT", offence);
    }

    // 과거 입력이나 미확인 관측을 적용 맥락으로 추정 금지
    const context = facts.context;
    // 값 및 해당 행위에 연결된 경기 문맥의 조건에 따라 처리 분기
    if (typeof facts.contactDetected.value !== "boolean" ||
            typeof facts.insidePenaltyArea.value !== "boolean" || !context ||
            typeof context.ballInPlay?.value !== "boolean" ||
            typeof context.onField?.value !== "boolean" ||
            typeof context.againstOpponent?.value !== "boolean" ||
            typeof context.insideOwnPenaltyArea?.value !== "boolean" ||
            !["ATTACKING_TEAM", "DEFENDING_TEAM"].includes(context.offenderRole?.value) ||
            !["NONE", "DOGSO", "SPA"].includes(context.disciplinaryContext?.value)) {
        // 해당 유형의 반칙 성립 결론 및 징계 구분을 설명하는 규정 인용을 반영한 결과 반환
        return inconclusive("FACTS_UNDETERMINED", [...offence, ...disciplineCitations]);
    }
    // 인플레이·장소·상대 관계와 징계 문맥이 현재 밀기 평가 범위에 맞는지 확인
    if (!context.ballInPlay.value || !context.onField.value || !context.againstOpponent.value ||
            context.disciplinaryContext.value !== "NONE" ||
            (context.insideOwnPenaltyArea.value && !facts.insidePenaltyArea.value)) {
        // 해당 유형의 반칙 성립 결론 및 징계 구분을 설명하는 규정 인용을 반영한 결과 반환
        return inconclusive("CONTEXT_UNSUPPORTED", [...offence, ...disciplineCitations]);
    }

    // 확인된 접촉 없음만 밀기 반칙 없음으로 처리
    if (facts.contactDetected.value === false) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            // 규정 대조로 계산한 판정 기록
            decision: "NO_FOUL",
            // 행위 강도 평가 기록
            severity: null,
            // 경기 재개에 관한 결과 기록
            restart: "PLAY_CONTINUED",
            // 징계에 관한 독립 결과 기록
            disciplinary: "NONE",
            // 카메라 근거 충분성에서 계산한 평가 신뢰 수준 기록
            confidence: confidence(facts),
            // 판정을 확정하지 못한 이유 기록
            inconclusiveReason: null,
            // 결론에 연결된 규정 인용 기록
            citations: offence,
        };
    }

    // 속도 게이트
    if (facts.severity.observedAtSpeed !== "NORMAL") {
        // 해당 유형의 반칙 성립 결론 및 비디오 판독 절차의 규정 인용을 반영한 결과 반환
        return inconclusive("SLOW_MOTION_ONLY", [...offence, ...reviewProcess]);
    }

    // 강도와 밀림 불확정 보류
    if (
        facts.severity.value === "uncertain" ||
        facts.opponentDisplacement.value === "uncertain" ||
        facts.opponentDisplacement.value === "possible"
    ) {
        // 해당 유형의 반칙 성립 결론 및 징계 구분을 설명하는 규정 인용을 반영한 결과 반환
        return inconclusive("SEVERITY_UNDETERMINED", [...offence, ...disciplineCitations]);
    }

    // 행위 강도 평가 참조
    const severity = facts.severity.value;

    // 파울과 재개와 징계 판정
    return {
        // 규정 대조로 계산한 판정 기록
        decision: "FOUL",
        // 행위 강도 평가 기록
        severity,
        // 경기 재개에 관한 결과 기록
        restart: context.insideOwnPenaltyArea.value ? "PENALTY_KICK" : "DIRECT_FREE_KICK",
        // 징계에 관한 독립 결과 기록
        disciplinary: discipline(severity),
        // 카메라 근거 충분성에서 계산한 평가 신뢰 수준 기록
        confidence: confidence(facts),
        // 판정을 확정하지 못한 이유 기록
        inconclusiveReason: null,
        // 결론에 연결된 규정 인용 기록
        citations: [...offence, ...disciplineCitations],
    };
};
