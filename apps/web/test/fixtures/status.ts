import type { SQL } from "drizzle-orm";
import type {
    AnalysisResultCommand,
    AnalysisResultStore,
    AnalysisSnapshot,
    CandidateSnapshot,
    MediaSnapshot,
    MediaStatusCommand,
    MediaStatusStore
} from "@replay/application";
import { mediaView } from "../../src/application/use-cases/status/view";

// 트랜잭션 밖 질의를 거부하고 요청한 트랜잭션 설정을 기록하는 가짜 읽기 데이터베이스 구성
export const readDatabase = (
    read: (statement: SQL) => Promise<unknown>,
    configs: unknown[] = []
) => ({
    execute: async () => {
        // 같은 읽기 시점을 보장하지 않는 트랜잭션 밖 질의 거부
        throw new Error("query-outside-transaction");
    },
    transaction: async <T>(
        run: (transaction: { execute: typeof read }) => Promise<T>,
        config: unknown
    ) => {
        // 요청한 격리 수준과 접근 방식 기록
        configs.push(config);
        // 트랜잭션 연결의 질의 실행기로 조회 결과 반환
        return run({ execute: read });
    }
});

// 관측과 사실 및 판정이 없는 후보 원자료 구성
export const candidateSnapshot = (
    changes: Partial<CandidateSnapshot> = {}
): CandidateSnapshot => ({
    id: "44444444-4444-4444-8444-444444444444",
    index: 1,
    category: "OTHER",
    startMs: 500,
    endMs: 1500,
    anchorMs: 1000,
    signalScore: 0.42,
    cameraSufficiency: "MEDIUM",
    reasons: ["motion-spike"],
    observation: null,
    tracking: null,
    sceneEvent: null,
    broadcastCue: null,
    shots: null,
    factRevisionId: null,
    factSource: null,
    facts: null,
    foulDecision: null,
    severity: null,
    restartType: null,
    disciplinaryAction: null,
    decisionMatch: null,
    confidenceLevel: null,
    inconclusiveReason: null,
    varReviewable: null,
    varCategory: null,
    varWithinTimeWindow: null,
    varThresholdMet: null,
    varIntervention: null,
    varNoInterventionReason: null,
    varNotReviewableReason: null,
    varWindowClosedReason: null,
    varWindowException: null,
    varReviewProcedure: null,
    varExplanation: null,
    citations: null,
    ...changes
});

// 검증된 경기 연결과 자동 평가가 없는 분석을 가진 영상 원자료 구성
export const mediaSnapshot = (changes: Partial<AnalysisSnapshot> = {}): MediaSnapshot => ({
    videoAssetId: "11111111-1111-4111-8111-111111111111",
    sourceSha256: null,
    videoStatus: "VALID",
    validationErrorCode: null,
    analysis: {
        analysisId: "22222222-2222-4222-8222-222222222222",
        status: "COMPLETED",
        pipelineVersion: null,
        stage: "SUCCEEDED",
        progressPercent: 100,
        failureCode: null,
        limitations: ["incident_category_classification_pending"],
        matchId: null,
        ruleVersionId: null,
        competition: null,
        season: null,
        ifabEdition: null,
        verificationStatus: null,
        sourceDocument: null,
        candidates: [candidateSnapshot()],
        evidence: [],
        automatic: null,
        ...changes
    }
});

// 저장소 원자료를 공개 정책 적용 전 내부 영상 화면 모델로 조회
export const statusView = async (
    store: MediaStatusStore,
    command: MediaStatusCommand
) => {
    // 한 읽기 스냅숏의 영상 원자료 조회
    const snapshot = await store.status(command);
    // 원자료가 있으면 내부 영상 화면 모델 반환
    return snapshot ? mediaView(snapshot) : null;
};

// 저장소 원자료를 공개 정책 적용 전 내부 분석 화면 모델로 조회
export const analysisView = async (
    store: AnalysisResultStore,
    command: AnalysisResultCommand
) => {
    // 세션 소유 분석이 속한 영상 원자료 조회
    const snapshot = await store.analysis(command);
    // 원자료가 있으면 내부 분석 화면 모델 반환
    return snapshot ? mediaView(snapshot).analysis : null;
};
