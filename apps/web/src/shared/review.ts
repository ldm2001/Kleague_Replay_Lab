// 규정 평가 결과형 가져오기
import type { EvaluationResult } from "./evaluation";
// 규정 입력 사실 자료형 가져오기
import type { PushFacts } from "./facts";

// 자동 평가 계약의 버전 고정
export const AUTOMATIC_REVIEW_VERSION = "automatic-review-v1" as const;
// 자동 평가에서 판단하지 않는 질문 목록 정의
export const AUTOMATIC_NOT_ASSESSED = Object.freeze([
    "OTHER_FOUL_TYPES",
    "GOAL_DECISION",
    "ORIGINAL_DECISION_CORRECTNESS",
    "VAR_INTERVENTION"
] as const);

// 자동 평가에 사용한 경기와 규정의 자료 구조 정의
export type AutomaticRuleContext = Readonly<{
    // 고유 식별자
    id: string;
    // 검증 대상 경기 식별자
    matchId: string;
    // 경기가 속한 대회
    competition: string;
    // 대회 시즌
    season: string;
    // 국제 경기 규칙 판본 식별자
    ifabVersionId: string;
    // 출처와 적용 정보의 검증 상태
    verificationStatus: "VERIFIED";
}>;

// 자동 사실 생산자의 검증 정보의 자료 구조 정의
export type AutomaticProducer = Readonly<{
    // 관측 방법 식별자
    methodId: string;
    // 확인할 버전
    version: string;
    // 방법 검증 보고서의 내용 해시
    validationReportSha256: string;
}>;

// 후보 하나의 자동 평가 결과의 자료 구조 정의
export type AutomaticReviewRow = Readonly<{
    // 기존 영상 후보의 순서
    candidateIndex: number;
    // 이번 규정 평가가 답하는 질문
    question: "PUSHING";
    // 현재 처리 상태
    status: "BLOCKED" | "COMPLETED";
    // 처리 상태를 설명하는 사유 코드
    reasonCodes: readonly string[];
    // 기존 보고서의 증거 순서 목록
    evidenceIndices: readonly number[];
    // 사실을 생성한 검증 대상 방법
    producer: AutomaticProducer | null;
    // 적용할 규정 정보
    rule: AutomaticRuleContext | null;
    // 평가에 사용할 사실 묶음
    facts: PushFacts | null;
    // 현재까지 계산한 결과
    result: EvaluationResult | null;
}>;

// 서버가 계산하고 작업·개정 이력과 원자적으로 저장하는 비공개 평가 묶음
export type AutomaticReviewBatch = Readonly<{
    // 확인할 버전
    version: typeof AUTOMATIC_REVIEW_VERSION;
    // 영상 분석 식별자
    analysisId: string;
    // 처리 작업 식별자
    jobId: string;
    // 작업의 재시도 세대
    jobRevision: number;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 영상 처리 파이프라인 버전
    pipelineVersion: string;
    // 영상 전체 처리 여부
    videoCoverage: "FULL" | "PARTIAL";
    // 요약에서 일부 관측이 빠졌는지 여부
    summaryTruncated: boolean;
    // 평가가 완료된 후보 수
    evaluatedCount: number;
    // 평가를 보류한 후보 수
    blockedCount: number;
    // 조회 또는 평가한 항목 목록
    rows: readonly AutomaticReviewRow[];
}>;

// 공개에는 객체 키와 비공개 관측을 포함 제외
export type AutomaticPublicResult = Pick<EvaluationResult,
    "decision" | "severity" | "restart" | "disciplinary" | "confidence" | "inconclusiveReason" |
    "varAssessment" | "citations" | "decisionMatch" | "factSignature">;

// 결과 처리
export const publicAutomaticResult = (result: AutomaticPublicResult): AutomaticPublicResult => ({
    // 규정 대조로 계산한 판정 기록
    decision: result.decision,
    // 행위 강도 평가 기록
    severity: result.severity,
    // 경기 재개에 관한 결과 기록
    restart: result.restart,
    // 징계에 관한 독립 결과 기록
    disciplinary: result.disciplinary,
    // 카메라 근거 충분성에서 계산한 평가 신뢰 수준 기록
    confidence: result.confidence,
    // 판정을 확정하지 못한 이유 기록
    inconclusiveReason: result.inconclusiveReason,
    // 비디오 판독의 독립 평가 기록
    varAssessment: result.varAssessment,
    // 결론에 연결된 규정 인용 기록
    citations: result.citations,
    // 계산 결과와 실제 판정의 일치 여부 기록
    decisionMatch: result.decisionMatch,
    // 사실 내용의 동일성 해시 기록
    factSignature: result.factSignature
});

// 공개 가능한 완료 자동 판정의 자료 구조 정의
export type AutomaticJudgment = Readonly<{
    // 결과 종류
    kind: "AUTOMATIC_PUSHING";
    // 현재 처리 상태
    status: "COMPLETED";
    // 판정 계산기의 버전
    evaluatorVersion: typeof AUTOMATIC_REVIEW_VERSION;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 기존 영상 후보의 순서
    candidateIndex: number;
    // 적용할 규정 정보
    rule: AutomaticRuleContext;
    // 사실을 생성한 검증 대상 방법
    producer: AutomaticProducer;
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 현재까지 계산한 결과
    result: AutomaticPublicResult;
    // 이번 평가에서 판단하지 않은 질문
    notAssessed: typeof AUTOMATIC_NOT_ASSESSED;
}>;
