// 공유 자료 계약과 검증 기능 가져옴
import {
    AUTOMATIC_NOT_ASSESSED,
    AUTOMATIC_REVIEW_VERSION,
    publicAutomaticResult,
    type AutomaticJudgment,
    type AutomaticReviewBatch,
    type AutomaticRuleContext
} from "../shared/review";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type { AnalysisEvidence } from "../application/ports/repositories/job-store";
// 공유 자료 계약과 검증 기능 가져옴
import type { EvaluationResult } from "../shared/evaluation";

// 판정·재개·징계가 완료됐는지 확인
const completeResult = (result: EvaluationResult | null): result is EvaluationResult =>
    !!result &&
    (result.decision === "FOUL" || result.decision === "NO_FOUL") &&
    result.restart !== null &&
    result.disciplinary !== null &&
    result.inconclusiveReason === null &&
    result.citations.length > 0;

// 제출 증거와 저장된 증거 식별자의 연결 정의
export type AutomaticEvidenceBinding = AnalysisEvidence &
    Readonly<{ evidenceIndex: number; evidenceId: string }>;
// 자동 평가의 원본 작업 규정 및 증거 대조 문맥 정의
export type AutomaticBindingContext = Readonly<{
    // 분석 기록의 식별자
    analysisId: string;
    // 처리 작업의 식별자
    jobId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 분석한 원본 영상의 내용 해시
    sourceSha256: string;
    // 영상 처리 절차를 구별하는 버전
    pipelineVersion: string;
    // 분석에 속한 후보 장면 순번 집합
    candidateIndices: readonly number[];
    // 원본에 연결한 증거 자료 또는 접근 기능
    evidence: readonly AnalysisEvidence[];
    // 경기 문맥에 맞춰 연결한 규정 자료
    rule: AutomaticRuleContext | null;
}>;

// 자동 평가 근거 확인
export function automaticProof(
    item: AnalysisEvidence,
    context: Pick<AutomaticBindingContext, "analysisId" | "jobId" | "jobRevision">
): boolean {
    // 현재 분석과 작업 판본 및 내용 해시를 묶은 증거 경로 생성
    const prefix = `evidence/${context.analysisId}/${context.jobId}/${context.jobRevision}/${item.contentSha256}/`;
    // 해시와 작업 경로 및 파일 확장자를 모두 충족한 증거 여부 반환
    return (
        /^[a-f0-9]{64}$/.test(item.contentSha256) &&
        item.objectKey.startsWith(prefix) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|mp4)$/.test(item.objectKey.slice(prefix.length))
    );
}

// 검증된 경기와 규정 판본의 일치 확인
export function sameAutomaticRule(
    a: AutomaticRuleContext | null,
    b: AutomaticRuleContext | null
): boolean {
    // 양쪽의 검증 상태와 경기 및 규정 판본 일치 여부 반환
    return (
        !!a &&
        !!b &&
        a.verificationStatus === "VERIFIED" &&
        b.verificationStatus === "VERIFIED" &&
        a.id === b.id &&
        a.matchId === b.matchId &&
        a.competition === b.competition &&
        a.season === b.season &&
        a.ifabVersionId === b.ifabVersionId
    );
}

// 평가 묶음의 원본·작업·후보·근거 결합 확인
export function validAutomaticBatch(
    batch: AutomaticReviewBatch,
    context: AutomaticBindingContext
): boolean {
    // 자동 평가의 원본 작업 버전과 후보 수 및 집계 일치 확인
    if (
        batch.version !== AUTOMATIC_REVIEW_VERSION ||
        batch.analysisId !== context.analysisId ||
        batch.jobId !== context.jobId ||
        batch.jobRevision !== context.jobRevision ||
        batch.sourceSha256 !== context.sourceSha256 ||
        !/^[a-f0-9]{64}$/.test(batch.sourceSha256) ||
        batch.pipelineVersion !== context.pipelineVersion ||
        batch.rows.length !== context.candidateIndices.length ||
        new Set(batch.rows.map((row) => row.candidateIndex)).size !== batch.rows.length ||
        batch.evaluatedCount !== batch.rows.filter((row) => row.status === "COMPLETED").length ||
        batch.blockedCount !== batch.rows.filter((row) => row.status === "BLOCKED").length
    ) {
        // 서로 일치하지 않는 자동 평가 묶음 거부 반환
        return false;
    }
    // 후보별 완료 조건과 증거 및 검증 규정 연결의 충족 여부 반환
    return batch.rows.every(
        (row) =>
            context.candidateIndices.includes(row.candidateIndex) &&
            row.question === "PUSHING" &&
            row.evidenceIndices.every(
                (index) =>
                    Number.isInteger(index) &&
                    index >= 0 &&
                    context.evidence[index]?.candidateIndex === row.candidateIndex
            ) &&
            (row.status === "BLOCKED"
                ? row.result === null
                : row.status === "COMPLETED" &&
                  batch.videoCoverage === "FULL" &&
                  !batch.summaryTruncated &&
                  completeResult(row.result) &&
                  row.facts !== null &&
                  row.producer !== null &&
                  sameAutomaticRule(row.rule, context.rule) &&
                  row.evidenceIndices.length > 0 &&
                  row.evidenceIndices.some((index) => context.evidence[index]?.kind === "CLIP") &&
                  row.evidenceIndices.every((index) =>
                      automaticProof(context.evidence[index]!, context)
                  ))
    );
}

// 현재 근거와 일치하는 완료 판정만 연결
export function automaticJudgments(
    batch: AutomaticReviewBatch,
    bindings: readonly AutomaticEvidenceBinding[],
    current: readonly AutomaticEvidenceBinding[],
    rule: AutomaticRuleContext | null
): Map<number, AutomaticJudgment> {
    // 후보 순번으로 완료된 자동 판단을 찾는 조회표 생성
    const result = new Map<number, AutomaticJudgment>();
    // 영상 전체 범위와 온전한 요약 및 계약 버전 미충족 확인
    if (
        batch.version !== AUTOMATIC_REVIEW_VERSION ||
        batch.videoCoverage !== "FULL" ||
        batch.summaryTruncated
    ) {
        // 공개 가능한 자동 판단이 없는 빈 조회표 반환
        return result;
    }
    // 보존된 후보별 자동 평가를 현재 증거와 하나씩 대조
    for (const row of batch.rows) {
        // 완료 결론과 검증된 생산자 및 규정과 증거 연결 미충족 확인
        if (
            row.status !== "COMPLETED" ||
            !completeResult(row.result) ||
            !row.producer ||
            !row.rule ||
            !sameAutomaticRule(row.rule, rule) ||
            row.evidenceIndices.length === 0
        )
            // 완료 공개 요건이 없는 후보 평가 건너뜀
            continue;
        // 평가에서 참조한 제출 순번을 저장 증거에 연결
        const evidence = row.evidenceIndices.map((index) =>
            bindings.find((item) => item.evidenceIndex === index)
        );
        // 영상 클립 근거가 없는 후보의 완료 공개 제외
        if (!evidence.some((item) => item?.kind === "CLIP")) continue;
        // 보존 증거와 현재 자산의 해시 경로 시간 범위 불일치 확인
        if (
            evidence.some(
                (item) =>
                    !item ||
                    item.candidateIndex !== row.candidateIndex ||
                    !automaticProof(item, batch) ||
                    !current.some(
                        (live) =>
                            live.evidenceId === item.evidenceId &&
                            live.candidateIndex === item.candidateIndex &&
                            live.contentSha256 === item.contentSha256 &&
                            live.objectKey === item.objectKey &&
                            live.startMs === item.startMs &&
                            live.endMs === item.endMs &&
                            live.kind === item.kind
                    )
            )
        )
            // 현재 저장 자산과 맞지 않는 평가 건너뜀
            continue;
        // 공개 요건을 충족한 밀기 평가와 미평가 질문 경계를 조회표에 저장
        result.set(row.candidateIndex, {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "AUTOMATIC_PUSHING",
            // 처리 상태 또는 요청 응답 상태
            status: "COMPLETED",
            // 자동 평가 계약을 구별하는 버전
            evaluatorVersion: AUTOMATIC_REVIEW_VERSION,
            // 분석한 원본 영상의 내용 해시
            sourceSha256: batch.sourceSha256,
            // 처리 결과에서 후보 장면을 찾는 순번
            candidateIndex: row.candidateIndex,
            // 경기 문맥에 맞춰 연결한 규정 자료
            rule: row.rule,
            // 규정 사실을 생산한 방법과 검증 출처
            producer: row.producer,
            // 참조하는 저장 증거 식별자 목록
            evidenceIds: evidence.map((item) => item!.evidenceId),
            // 해당 단계의 처리 결과
            result: publicAutomaticResult(row.result),
            // 이번 평가에서 다루지 않은 질문 목록
            notAssessed: AUTOMATIC_NOT_ASSESSED
        });
    }
    // 현재 근거로 재검증된 자동 판단 조회표 반환
    return result;
}
