// 결과 조회 명령
// 관측과 판정 및 자동 평가의 공유 자료 계약 가져옴
import type {
    AutomaticJudgment,
    AutomaticReviewBatch,
    BroadcastCue,
    EvaluationFacts,
    EvaluationResult,
    PerceptionRun,
    PipelineFilterResult,
    RuleCitation,
    SceneEvent,
    SceneObservation,
    TrackingSummary,
    VarScopeEvaluation
} from "@replay/shared-types";
// 제출 증거와 저장 증거 연결 계약 가져옴
import type { AutomaticEvidenceBinding } from "./job-store";

// 증거 화면 모델
export type EvidenceView = Readonly<{
    // 저장된 증거 자산의 식별자
    evidenceId: string;
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "FRAME" | "CLIP";
}>;

// 후보 화면 모델
export type CandidateView = Readonly<{
    // 완료 조건을 별도로 검사하는 자동 규정 평가 결과
    automaticJudgment?: AutomaticJudgment | null;
    // 동일 물체의 연속 이동 관측
    tracking?: TrackingSummary | null;
    // 장면에서 인식한 사건과 근거
    sceneEvent?: SceneEvent | null;
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcastCue?: BroadcastCue | null;
    // 전체 반칙 판단과 별개인 영상 판독 범주 평가
    varScopeEvaluation?: VarScopeEvaluation | null;
    // 원시 후보에 대한 규정 필터 결과
    filter?: PipelineFilterResult;
    // 최신 사실은 판정이 없어도 보정과 재시도에 사용
    factRevisionId?: string | null;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts?: EvaluationFacts | null;
    // 실제 샷의 식별자와 시간 범위
    shots?: readonly Readonly<{ id: string; index: number; startMs: number; endMs: number }>[];
    // 자동 추출한 관찰 후보
    observation?: SceneObservation | null;
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 목록 안에서 해당 항목을 식별하는 순번
    index: number;
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 장면을 대표하는 원본 영상 시각
    anchorMs: number | null;
    // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
    signalScore: number | null;
    // 관측에 필요한 화면의 충분성
    cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
    // 후보 생성 또는 처리 결과의 근거 사유
    reasons: readonly string[];
    // 원본에 연결한 증거 자료 또는 접근 기능
    evidence?: readonly EvidenceView[];
    // 사실과 규정을 대조한 판단 결과
    judgment?: JudgmentView | null;
}>;

// 판정 화면 모델
export type JudgmentView = Readonly<{
    // 평가에 사용한 사실 판본 식별자
    factRevisionId: string;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: EvaluationFacts;
    // 값의 출처 또는 원본 접근 수단
    source: "MODEL" | "USER" | "CURATOR";
    // 사실과 규정을 대조하는 판단 처리
    decision: EvaluationResult["decision"];
    // 규정 평가에서 구분한 행위의 심각도
    severity: EvaluationResult["severity"];
    // 판단에 따른 경기 재개 방식
    restart: EvaluationResult["restart"];
    // 판단에 따른 징계 조치
    disciplinary: EvaluationResult["disciplinary"];
    // 관측 원심과 규정 평가의 일치 여부
    decisionMatch: EvaluationResult["decisionMatch"];
    // 관측 또는 판단 근거의 신뢰 수준
    confidence: EvaluationResult["confidence"];
    // 결론을 확정하지 못한 사유
    inconclusiveReason: EvaluationResult["inconclusiveReason"];
    // 영상 판독 개입에 대한 규정 평가
    varAssessment: NonNullable<EvaluationResult["varAssessment"]>;
    // 판단 근거가 된 규정 인용 목록
    citations: readonly RuleCitation[];
}>;

// 분석 화면 모델
export type AnalysisView = Readonly<{
    // 후보별 자동 평가 진행의 내부 집계
    automaticReviewSummary?: Readonly<{
        // 인식 처리가 실제 다룬 영상 범위
        videoCoverage: "FULL" | "PARTIAL";
        // 요약 일부가 잘려 보존되지 않았는지 여부
        summaryTruncated: boolean;
        // 자동 평가 조건을 검사한 후보 수
        checkedCount: number;
        // 지원 질문의 평가를 완료한 후보 수
        completedCount: number;
        // 근거 부족 등으로 평가가 막힌 후보 수
        blockedCount: number;
    }>;
    // 완료된 규정 평가만 공개하는 결과 정책
    resultPolicy?: "COMPLETED_ONLY";
    // 전체 내부 후보의 필터 처리 집계
    filterSummary?: Readonly<{
        // 자동 평가 조건을 검사한 후보 수
        checkedCount: number;
        // 필터가 제외한 후보 수
        excludedCount: number;
        // 필터가 판단을 확정하지 못한 후보 수
        undeterminedCount: number;
        // 관측된 사건 후보 수
        observedCount?: number;
        // 규정 적용 가능 조건을 충족한 후보 수
        applicableCount?: number;
    }>;
    // 최종 결과와 분리한 내부 진단 자료
    diagnostics?: Readonly<{
        // 사건으로 인식되지 않은 원시 변화 후보 수
        rawProposalCount: number;
        // 유효성 조건을 통과하지 못한 산출물 수
        invalidOutputCount: number;
        // 사건 종류를 인식한 후보 수
        recognizedEventCount: number;
        // 현재 인식기가 지원하는 사건 유형 목록
        supportedEventTypes: readonly ("CORNER_KICK" | "GOAL_GRAPHIC")[];
        // 후보 생성 또는 처리 결과의 근거 사유
        reasons: readonly string[];
    }>;
    // 분석 기록의 식별자
    analysisId: string;
    // 자료를 해석하거나 표시하는 방식
    mode: "VISUAL_CHANGE_BASELINE" | "ADJUDICATED";
    // 영상 처리 성공과 구분한 규정 판단 상태
    judgmentStatus: "NOT_EVALUATED" | "PARTIAL" | "EVALUATED";
    // 처리 상태 또는 요청 응답 상태
    status: string;
    // 현재 영상 처리 단계
    stage: string;
    // 작업 진행률의 백분율
    progressPercent: number;
    // 처리 실패 원인을 구별하는 코드
    failureCode: string | null;
    // 처리가 제공하지 못하는 관측의 한계
    limitations: readonly string[];
    // 경기 문맥에 맞춰 연결한 규정 자료
    rule?: RuleView | null;
    // 완료된 반칙 규정 평가 수
    evaluatedCount?: number;
    // 전체 반칙 판단과 구분한 완료 범주 평가 수
    completedScopeCount?: number;
    // 파울 확정과 별개로 관리하는 후보 장면 목록
    candidates: readonly CandidateView[];
}>;

// 규정 판본 화면 모델
export type RuleView = Readonly<{
    // 규정 적용 대상 대회
    competition: string;
    // 규정 적용 대상 시즌
    season: string;
    // 국제 축구 규정의 판본
    ifabEdition: string;
    // 규정 문맥의 검증 상태
    verificationStatus: string;
    // 원본 영상의 출처 주소
    sourceUrl: string | null;
}>;

// 영상 상태 화면 모델
export type MediaView = Readonly<{
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string;
    // 영상 파일의 검증 상태
    videoStatus: string;
    // 영상 유효성 검사 실패 사유
    validationErrorCode: string | null;
    // 원본 영상에 연결된 분석 상태와 결과 자료
    analysis: AnalysisView | null;
}>;

// 하나의 읽기 스냅숏에서 조회한 영상 원자료
export type MediaSnapshot = Readonly<{
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string;
    // 분석한 원본 영상의 내용 해시
    sourceSha256: string | null;
    // 영상 파일의 검증 상태
    videoStatus: string;
    // 영상 유효성 검사 실패 사유
    validationErrorCode: string | null;
    // 원본 영상에 연결된 분석 원자료
    analysis: AnalysisSnapshot | null;
}>;

// 분석 진행과 적용 규정 및 후보 증거 자동 평가의 원자료
export type AnalysisSnapshot = Readonly<{
    // 분석 기록의 식별자
    analysisId: string;
    // 임대 중인 작업 단계를 반영한 분석 처리 상태
    status: string;
    // 영상 처리 절차를 구별하는 버전
    pipelineVersion: string | null;
    // 현재 영상 처리 단계
    stage: string;
    // 작업 진행률의 백분율
    progressPercent: number;
    // 처리 실패 원인을 구별하는 코드
    failureCode: string | null;
    // 처리가 제공하지 못하는 관측의 한계
    limitations: readonly string[] | null;
    // 검증된 경기 기록의 식별자
    matchId: string | null;
    // 대회 규정 판본 식별자
    ruleVersionId: string | null;
    // 규정 적용 대상 대회
    competition: string | null;
    // 규정 적용 대상 시즌
    season: string | null;
    // 국제 축구 규정의 판본
    ifabEdition: string | null;
    // 규정 문맥의 검증 상태
    verificationStatus: string | null;
    // 규정 검증에 사용한 원문 출처
    sourceDocument: string | null;
    // 신호 점수 순서로 정렬한 후보 원자료
    candidates: readonly CandidateSnapshot[];
    // 후보 순번과 종류 순서로 정렬한 유효 증거 원자료
    evidence: readonly EvidenceSnapshot[];
    // 가장 최근의 유효한 자동 평가 원자료
    automatic: AutomaticSnapshot | null;
}>;

// 후보 관측과 현재 사실 및 최신 판정의 원자료
export type CandidateSnapshot = Readonly<{
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 처리 결과에서 후보 장면을 찾는 순번
    index: number;
    // 후보 사건의 분류
    category: string;
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 장면을 대표하는 원본 영상 시각
    anchorMs: number | null;
    // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
    signalScore: number | null;
    // 관측에 필요한 화면의 충분성
    cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
    // 후보 생성 또는 처리 결과의 근거 사유
    reasons: readonly string[];
    // 판정 사실과 구분하여 보존하는 원시 관측
    observation: SceneObservation | null;
    // 동일 물체의 연속 이동 관측
    tracking: TrackingSummary | null;
    // 장면에서 인식한 사건과 근거
    sceneEvent: SceneEvent | null;
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcastCue: BroadcastCue | null;
    // 후보에 연결된 화면 구간 목록
    shots: NonNullable<CandidateView["shots"]> | null;
    // 평가에 사용한 사실 판본 식별자
    factRevisionId: string | null;
    // 사실 기록의 출처
    factSource: "MODEL" | "USER" | "CURATOR" | null;
    // 평가에 연결한 당시 사실 내용
    facts: unknown;
    // 규정 평가로 얻은 반칙 판단
    foulDecision: string | null;
    // 규정 평가에서 구분한 행위의 심각도
    severity: string | null;
    // 규정 평가에 따른 경기 재개 방식
    restartType: string | null;
    // 규정 평가에 따른 징계 조치
    disciplinaryAction: string | null;
    // 관측 원심과 규정 평가의 일치 여부
    decisionMatch: string | null;
    // 규정 판단 근거의 충분성 수준
    confidenceLevel: string | null;
    // 결론을 확정하지 못한 사유
    inconclusiveReason: string | null;
    // 영상 판독 검토 대상 여부
    varReviewable: boolean | null;
    // 영상 판독의 적용 범주
    varCategory: string | null;
    // 영상 판독 허용 시점 충족 여부
    varWithinTimeWindow: boolean | null;
    // 영상 판독 개입 문턱 충족 여부
    varThresholdMet: string | null;
    // 영상 판독 개입 판단
    varIntervention: string | null;
    // 영상 판독에 개입하지 않는 이유
    varNoInterventionReason: string | null;
    // 영상 판독 검토 대상이 아닌 이유
    varNotReviewableReason: string | null;
    // 영상 판독 허용 시점이 지난 이유
    varWindowClosedReason: string | null;
    // 영상 판독 시점 제한에 적용한 예외
    varWindowException: string | null;
    // 영상 판독 검토 절차
    varReviewProcedure: string | null;
    // 영상 판독 판단의 설명
    varExplanation: string | null;
    // 보존된 규정 판단의 인용 목록
    citations: readonly unknown[] | null;
}>;

// 만료와 삭제를 제외한 증거 자산 원자료
export type EvidenceSnapshot = Readonly<{
    // 저장된 증거 자산의 식별자
    evidenceId: string;
    // 처리 결과에서 후보 장면을 찾는 순번
    candidateIndex: number;
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "FRAME" | "CLIP";
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: string;
}>;

// 보존된 자동 평가와 당시 모델 출처 및 현재 경기 문맥의 원자료
export type AutomaticSnapshot = Readonly<{
    // 보존된 후보별 자동 평가 묶음
    summary: AutomaticReviewBatch;
    // 제출 증거 순서와 저장 식별자의 연결
    evidenceBindings: readonly AutomaticEvidenceBinding[];
    // 현재 경기와 규정 연결의 유효 여부
    matchContextValid: boolean;
    // 사용한 모델과 고정 가중치의 출처
    modelProvenance: PerceptionRun["models"] | null;
}>;

// 영상 상태 조회 입력
export type MediaStatusCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 영상 상태 저장 포트
export type MediaStatusStore = Readonly<{
    // 소유와 만료를 확인한 영상 원자료를 하나의 읽기 스냅숏으로 조회
    status: (command: MediaStatusCommand) => Promise<MediaSnapshot | null>;
}>;

// 분석 결과 조회 입력
export type AnalysisResultCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 분석 결과 저장 포트
export type AnalysisResultStore = Readonly<{
    // 세션 소유 분석이 속한 영상 원자료를 하나의 읽기 스냅숏으로 조회
    analysis: (command: AnalysisResultCommand) => Promise<MediaSnapshot | null>;
}>;

// 증거 미디어 모델
export type EvidenceMedia = Readonly<{
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일의 실제 또는 허용 콘텐츠 형식
    contentType: "image/jpeg" | "video/mp4";
}>;

// 증거 미디어 조회 입력
export type EvidenceMediaCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 저장된 증거 자산의 식별자
    evidenceId: string;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 증거 미디어 저장 포트
export type EvidenceMediaStore = Readonly<{
    // 영상 원본과 분석의 상태 자료
    media: (command: EvidenceMediaCommand) => Promise<EvidenceMedia | null>;
}>;

// 최근 영상 조회 입력
export type LatestMediaCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 최근 영상 저장 포트
export type LatestMediaStore = Readonly<{
    // 현재 세션의 최근 업로드 조회 기능
    latest: (command: LatestMediaCommand) => Promise<string | null>;
}>;
