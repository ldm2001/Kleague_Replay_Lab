// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상과 분석 진행 상태 조회 계약 가져옴
import type {
    AnalysisResultStore,
    AnalysisView,
    CandidateView
} from "../../ports/repositories/status-store";
// 공유 자료 계약과 검증 기능 가져옴
import {
    AUTOMATIC_NOT_ASSESSED,
    AUTOMATIC_REVIEW_VERSION,
    publicAutomaticResult,
    broadcastCueData,
    VAR_SCOPE_NOT_ASSESSED
} from "@replay/shared-types";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 결과 조회 입력
export type ReportInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
}>;

// 분석 결과 조회 결과
export type ReportResult = AnalysisView | null | Readonly<{ kind: "INVALID_INPUT" }>;

// 분석 결과 의존성
export type ReportDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: AnalysisResultStore;
}>;

// 서버의 범위 평가만 공개하며 기존 판정 이력과 단순 장면 인식은 완료 근거에서 제외
const completedScope = (candidate: CandidateView): boolean => {
    // 후보에 연결한 영상 판독 범주 평가 읽음
    const value = candidate.varScopeEvaluation;
    // 범주 평가의 출처를 대조할 방송 단서 읽음
    const cue = candidate.broadcastCue;
    // 범주 평가의 완료 상태와 방송 단서 및 검증 규정 출처 일치 확인
    if (
        !value ||
        candidate.filter?.status === "EXCLUDED" ||
        !broadcastCueData(cue, candidate.startMs, candidate.endMs) ||
        value.kind !== "COMPETITION_VAR_SCOPE" ||
        value.status !== "COMPLETED" ||
        value.topic !== "GOAL_RELATED" ||
        value.included !== true ||
        value.provenance?.origin !== "VIDEO_CUE_AND_COMPETITION_RULES" ||
        value.provenance.evaluatorVersion !== "competition-var-scope-v1" ||
        value.provenance.cueMethod !== cue.method ||
        value.provenance.cueStartMs !== cue.startMs ||
        value.provenance.cueEndMs !== cue.endMs ||
        !/^[0-9a-f]{64}$/.test(value.provenance.sourceSha256) ||
        !/^[0-9a-f]{64}$/.test(value.provenance.ruleDocumentSha256) ||
        !Array.isArray(value.citations) ||
        value.citations.length === 0 ||
        !Array.isArray(value.evidenceIds) ||
        value.evidenceIds.length === 0 ||
        !Array.isArray(value.notAssessed) ||
        !VAR_SCOPE_NOT_ASSESSED.every((item) => value.notAssessed.includes(item))
    ) {
        // 검증 요건을 충족하지 못한 범주 결과의 공개 불가 반환
        return false;
    }
    // 현재 후보의 영상 클립 증거 식별자 집합 생성
    const clips = new Set(
        (candidate.evidence ?? [])
            .filter((item) => item.kind === "CLIP")
            .map((item) => item.evidenceId)
    );
    // 실제 클립 근거와 같은 대회 시즌 규정 인용의 일치 여부 반환
    return (
        value.evidenceIds.every((id) => clips.has(id)) &&
        value.citations.every(
            (item) =>
                item.authority === "KLEAGUE" &&
                item.edition === value.season &&
                item.ruleId.startsWith(`${value.ruleVersionId}-`)
        )
    );
};

// 완료된 자동 판정의 공개 조건 확인
const completedAutomatic = (candidate: CandidateView): boolean => {
    // 후보에 연결한 자동 반칙 평가 읽음
    const value = candidate.automaticJudgment;
    // 자동 밀기 평가의 완료 결론과 검증 생산자 및 규정 계약 확인
    if (
        !value ||
        value.kind !== "AUTOMATIC_PUSHING" ||
        value.status !== "COMPLETED" ||
        value.evaluatorVersion !== AUTOMATIC_REVIEW_VERSION ||
        value.candidateIndex !== candidate.index ||
        !/^[a-f0-9]{64}$/.test(value.sourceSha256) ||
        !value.producer?.methodId ||
        !value.producer.version ||
        !/^[a-f0-9]{64}$/.test(value.producer.validationReportSha256) ||
        value.rule?.verificationStatus !== "VERIFIED" ||
        !UUID.test(value.rule.id) ||
        !UUID.test(value.rule.matchId) ||
        candidate.filter?.status === "EXCLUDED" ||
        !value.result ||
        !["FOUL", "NO_FOUL"].includes(value.result.decision) ||
        !value.result.restart ||
        value.result.restart === "UNKNOWN" ||
        value.result.disciplinary === null ||
        value.result.inconclusiveReason !== null ||
        value.result.varAssessment !== null ||
        !Array.isArray(value.result.citations) ||
        !value.result.citations.length ||
        !value.result.citations.some(
            (citation) =>
                citation.authority === "IFAB" &&
                `ifab-${citation.edition}` === value.rule.ifabVersionId
        ) ||
        !Array.isArray(value.notAssessed) ||
        !AUTOMATIC_NOT_ASSESSED.every((item) => value.notAssessed.includes(item)) ||
        !Array.isArray(value.evidenceIds) ||
        !value.evidenceIds.length
    ) {
        // 완료 공개 요건을 충족하지 못한 자동 판단 제외 반환
        return false;
    }
    // 공개할 증거 식별자와 파일 종류의 조회표 생성
    const evidence = new Map(
        (candidate.evidence ?? []).map((item) => [item.evidenceId, item.kind])
    );
    // 모든 증거가 존재하며 영상 클립 근거도 포함되었는지 반환
    return (
        value.evidenceIds.every((id) => evidence.has(id)) &&
        value.evidenceIds.some((id) => evidence.get(id) === "CLIP")
    );
};

// 결과 조회와 진행 조회가 같은 공개 경계를 사용
export const publicAnalysis = (result: AnalysisView): AnalysisView => {
    // 예전 수동 평가 이력인지 구분하여 기존 조회 계약 보존
    if (
        !result.diagnostics &&
        !result.automaticReviewSummary &&
        result.resultPolicy !== "COMPLETED_ONLY"
    ) {
        // 자동 공개 정책 이전 이력을 변경 없이 반환
        return result;
    }
    // 공개 응답에서 내부 진단과 평가 집계 제거
    const {
        diagnostics: _diagnostics,
        filterSummary: _filterSummary,
        automaticReviewSummary: _review,
        ...publicResult
    } = result;
    // 완료 평가를 가진 후보만 원본 시각순으로 정렬하여 공개 자료 생성
    const candidates = result.candidates
        .filter((candidate) => completedScope(candidate) || completedAutomatic(candidate))
        .sort((first, second) => first.startMs - second.startMs || first.index - second.index)
        .map((candidate): CandidateView => {
            // 공개 후보에서 미검증 관측과 예전 사실 및 판단 제거
            const {
                judgment: _judgment,
                facts: _facts,
                factRevisionId: _revision,
                observation: _observation,
                filter: _filter,
                tracking: _tracking,
                sceneEvent: _sceneEvent,
                automaticJudgment: _automatic,
                varScopeEvaluation: _scope,
                broadcastCue: _cue,
                ...visible
            } = candidate;
            // 완료된 범주 평가에 연결된 방송 단서만 선택
            const cue = completedScope(candidate) ? candidate.broadcastCue : null;
            // 비공개 관측과 기존 판단을 제거하고 완료된 질문 결과만 반환
            return {
                ...visible,
                // 사실과 규정을 대조한 판단 결과
                judgment: null,
                // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
                signalScore: null,
                // 후보 생성 또는 처리 결과의 근거 사유
                reasons: [],
                ...(completedAutomatic(candidate)
                    ? {
                          // 완료 조건을 별도로 검사하는 자동 규정 평가 결과
                          automaticJudgment: {
                              ...candidate.automaticJudgment!,
                              // 해당 단계의 처리 결과
                              result: publicAutomaticResult(candidate.automaticJudgment!.result)
                          }
                      }
                    : {}),
                ...(cue
                    ? {
                          // 전체 반칙 판단과 별개인 영상 판독 범주 평가
                          varScopeEvaluation: candidate.varScopeEvaluation,
                          // 규정 사실과 구분하여 보존하는 방송 단서
                          broadcastCue: {
                              // 처리 분기 또는 자료 종류를 구별하는 값
                              kind: cue.kind,
                              // 관측 단서를 계산한 방법
                              method: cue.method,
                              // 원본 영상 기준 구간 시작 밀리초
                              startMs: cue.startMs,
                              // 원본 영상 기준 구간 종료 밀리초
                              endMs: cue.endMs,
                              // 근거가 관측된 원본 영상 시각 목록
                              evidenceTimestampsMs: [...cue.evidenceTimestampsMs]
                          }
                      }
                    : {})
            };
        });
    // 영상 판독 범주 완료와 분리하여 자동 반칙 평가 완료 수 계산
    const evaluatedCount = candidates.filter(
        (candidate) => candidate.automaticJudgment != null
    ).length;
    // 전체 반칙 완료와 구분한 부분 평가 집계 및 완료 후보만 반환
    return {
        ...publicResult,
        // 완료된 규정 평가만 공개하는 결과 정책
        resultPolicy: "COMPLETED_ONLY",
        // 자료를 해석하거나 표시하는 방식
        mode: evaluatedCount ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
        // 지원 밀기 질문의 완료를 영상의 모든 파울 평가 완료로 확대하지 않음
        judgmentStatus: evaluatedCount ? "PARTIAL" : "NOT_EVALUATED",
        // 완료된 반칙 규정 평가 수
        evaluatedCount,
        // 경기 문맥에 맞춰 연결한 규정 자료
        rule: null,
        // 전체 반칙 판단과 구분한 완료 범주 평가 수
        completedScopeCount: candidates.filter((candidate) => candidate.varScopeEvaluation != null)
            .length,
        // 파울 확정과 별개로 관리하는 후보 장면 목록
        candidates
    };
};

// 공개 가능한 분석 결과 구성
export const report =
    ({ clock, repository }: ReportDependencies) =>
    async (input: ReportInput): Promise<ReportResult> => {
        // 세션과 분석 식별자 확인
        if (!UUID.test(input.anonymousSessionId) || !UUID.test(input.analysisId)) {
            // 분석 결과 조회 식별자 오류 반환
            return { kind: "INVALID_INPUT" };
        }
        // 분석 결과 저장소 조회
        // 식별자 소문자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 분석 기록의 식별자의 대소문자 차이 제거
        const analysisId = input.analysisId.toLowerCase();
        // 결과 저장소 호출
        const result = await repository.analysis({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 분석 기록의 식별자
            analysisId,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString(),
        });
        // 과거 수동 평가 이력의 조회 계약은 유지
        return result ? publicAnalysis(result) : null;
    };
