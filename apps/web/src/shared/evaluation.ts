// 규정 인용 자료형 가져오기
import type { AuthorityAccount, FactRequirement, LayerConflict, RuleCitation } from "./citation";
// 공통 상태 값 목록 가져오기
import type {
    ConfidenceLevel,
    Decision,
    DecisionMatch,
    DisciplinaryAction,
    EvaluationErrorCode,
    InconclusiveReason,
    RestartType,
    Severity,
    VarCategory,
    VarIntervention,
    VarNoInterventionReason,
    VarNotReviewableReason,
    VarReviewProcedure,
    VarThresholdResult,
    VarWindowClosedReason,
    VarWindowException
} from "./vocabulary";

// 비디오 판독 네 게이트의 독립 결과
export type VarAssessment = {
    // 게이트 1 결과
    reviewable: boolean;
    // 게이트 1 범주
    category: VarCategory;
    // 게이트 2 결과
    withinTimeWindow: boolean;
    // 게이트 3 결과
    thresholdMet: VarThresholdResult;
    // 게이트 4 결과
    reviewProcedure: VarReviewProcedure;
    // 비디오 판독 개입 결과
    intervention: VarIntervention;
    // 게이트 차단 사유
    noInterventionReason: VarNoInterventionReason | null;
    // 범주 차단 사유
    notReviewableReason: VarNotReviewableReason | null;
    // 시한 차단 사유
    windowClosedReason: VarWindowClosedReason | null;
    // 예외가 있으면 재개 후에도 검토 창 유지
    windowException: VarWindowException;
    // 결과를 설명하는 내용
    explanation: string;
};

// 규정 대조 결과의 자료 구조 정의
export type EvaluationResult = {
    // 규정이 말하는 내용
    accounts: AuthorityAccount[];
    // 서로 충돌하는 규정 조건
    conflicts: LayerConflict[];

    // 조항 트리 도달 범위
    narrowedTo: RuleCitation[];
    // 해당 규정으로 차단된 검토 범주
    blockedFrom: FactRequirement[];

    // 비디오 판독 네 게이트 결과
    varAssessment: VarAssessment | null;

    // 규정 적용 참고 판정
    decision: Decision;
    // 행위 강도 평가
    severity: Severity | null;
    // 경기 재개에 관한 결과
    restart: RestartType | null;
    // 징계에 관한 독립 결과
    disciplinary: DisciplinaryAction | null;
    // 계산 결과와 실제 판정의 일치 여부
    decisionMatch: DecisionMatch;

    // 영상과 관측 한계
    confidence: ConfidenceLevel;
    // 판정을 확정하지 못한 이유
    inconclusiveReason: InconclusiveReason | null;

    // 결과 재현 정보
    factSignature: string;
    // 해시 계산에 사용할 사실 내용
    factSignatureInput: string;

    // 최소 한 개의 인용
    citations: RuleCitation[];
};

// 입력 부족 오류 결과
// 규정 평가 실패 모델
export type EvaluationFailure = {
    // 검사 조건 충족 여부
    ok: false;
    // 처리 중 발생한 오류
    error: EvaluationErrorCode;
    // 결과 또는 오류 설명
    message: string;
};

// 비디오 판독 평가 결과
export type VarOutcome =
    | {
            // 검사 조건 충족 여부
            ok: true;
            // 규정 평가 결과
            assessment: VarAssessment;
            // 결론에 연결된 규정 인용
            citations: RuleCitation[];
            // 사실 내용의 동일성 해시
            factSignature: string;
            // 해시 계산에 사용할 사실 내용
            factSignatureInput: string;
        }
    | EvaluationFailure;

// 실패 결과 판별
export const failure = (outcome: VarOutcome): outcome is EvaluationFailure =>
    outcome.ok === false;
