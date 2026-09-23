// 규정 자료와 평가 기능 가져옴
import { competitionSet } from "@replay/rule-data";
// 규정 자료와 평가 기능 가져옴
import { perceptionModelPins, pushResult } from "@replay/rule-engine";
// 공유 자료 계약과 검증 기능 가져옴
import {
    AUTOMATIC_REVIEW_VERSION,
    type AutomaticProducer,
    type AutomaticReviewBatch,
    type AutomaticReviewRow,
    type AutomaticRuleContext,
    type PerceptionIncident,
    type PerceptionRun,
    type PushFacts
} from "@replay/shared-types";
// 영상 작업의 임대와 결과 처리 계약 가져옴
import type { AnalysisCandidate } from "../../ports/repositories/job-store";
// 후보 사실과 평가 처리 계약 가져옴
import { pushFactsData } from "./facts";

// 서버가 확인한 자동 평가 증거 참조 정의
export type AutomaticReference = Readonly<{
    // 제출 목록에서 증거를 찾는 순번
    evidenceIndex: number; candidateIndex: number; kind: "FRAME" | "CLIP";
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number; endMs: number; contentSha256: string; immutable: boolean;
}>;

// 자동 검토 입력 계약 정의
export type AutomaticReviewInput = Readonly<{
    // 분석 기록의 식별자
    analysisId: string; jobId: string; jobRevision: number; durationMs: number;
    // 분석한 원본 영상의 내용 해시
    sourceSha256: string; pipelineVersion: string; perception: PerceptionRun;
    // 파울 확정과 별개로 관리하는 후보 장면 목록
    candidates: readonly AnalysisCandidate[]; references: readonly AutomaticReference[];
    // 경기 문맥에 맞춰 연결한 규정 자료
    rule: AutomaticRuleContext | null;
}>;

// 지원 여부와 검증 출처를 포함한 규정 사실 생산 결과 정의
export type AutomaticFacts =
    | Readonly<{ kind: "UNSUPPORTED"; reasons: readonly string[] }>
    | Readonly<{
          // 처리 분기 또는 자료 종류를 구별하는 값
          kind: "READY";
          // 규정 사실을 생산한 방법과 검증 출처
          producer: AutomaticProducer;
          // 확인된 출처와 판본을 보존하는 규정 사실 자료
          facts: PushFacts;
          // 제출 목록에서 참조한 증거 순번 목록
          evidenceIndices: readonly number[];
      }>;

// 자동 검토 의존 기능 계약 정의
export type AutomaticReviewDependencies = Readonly<{
    // 검증된 사실 생산 방법의 등록 목록
    registry: readonly AutomaticProducer[];
    // 관측에서 지원 가능한 규정 사실을 생산하는 기능
    produce: (
        input: Readonly<{
            // 사실 채택과 구분한 모델 관측 처리 자료
            perception: PerceptionRun;
            // 현재 처리하는 후보 장면
            candidate: AnalysisCandidate;
            // 현재 후보와 연결한 인식 사건
            incident: PerceptionIncident;
        }>
    ) => AutomaticFacts;
}>;

// 검출·관절·음향 단서는 아직 규정 사실의 검증된 생산자가 아님
// 환경 변수와 작업자 전송 자료를 통한 승인 목록 변경 차단
const operating: AutomaticReviewDependencies = Object.freeze({
    // 검증된 사실 생산 방법의 등록 목록
    registry: Object.freeze([]),
    // 관측에서 지원 가능한 규정 사실을 생산하는 기능
    produce: () => ({
        // 처리 분기 또는 자료 종류를 구별하는 값
        kind: "UNSUPPORTED" as const,
        // 후보 생성 또는 처리 결과의 근거 사유
        reasons: [
            "FACT_PRODUCER_UNVERIFIED",
            "CONTACT_UNVERIFIED",
            "INTENSITY_UNVERIFIED",
            "MATCH_CONTEXT_FACTS_UNVERIFIED"
        ]
    })
});

// 해시 형식 확인
const hash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

// 검증된 사실 생산자와 판본 일치 확인
const sameProducer = (a: AutomaticProducer, b: AutomaticProducer): boolean =>
    a.methodId === b.methodId &&
    a.version === b.version &&
    a.validationReportSha256 === b.validationReportSha256 &&
    hash(a.validationReportSha256);

// 후보별 자동 규정 평가와 보류 사유 구성
export const automaticReview = (
    input: AutomaticReviewInput,
    dependencies: AutomaticReviewDependencies = operating
): AutomaticReviewBatch => {
    // 자동 평가에 사용할 인식 실행 기록 읽음
    const run = input.perception;
    // 영상 전체 시간과 표본 처리 성공을 함께 확인
    const full =
        Number.isSafeInteger(input.durationMs) &&
        input.durationMs > 0 &&
        run.processingStatus === "COMPLETE" &&
        run.coverage.startMs === 0 &&
        run.coverage.endMs >= input.durationMs &&
        run.coverage.expectedSamples === run.coverage.processedSamples &&
        run.coverage.failedSamples === 0;
    // 모든 후보에 공통 적용할 평가 보류 사유 목록 생성
    const sharedReasons: string[] = [];
    // 전체 영상과 표본을 처리하지 못했으면 공통 보류 사유 추가
    if (!full) sharedReasons.push("FULL_VIDEO_COVERAGE_INCOMPLETE");
    // 요약이 절단되었으면 근거 완전성 부족 사유 추가
    if (run.summary.truncated) sharedReasons.push("SUMMARY_TRUNCATED");
    // 인식 실행과 분석 원본의 내용 해시 불일치 확인
    if (!hash(input.sourceSha256) || run.sourceSha256 !== input.sourceSha256)
        // 원본 동일성 미검증을 모든 후보의 보류 사유에 기록
        sharedReasons.push("SOURCE_HASH_UNVERIFIED");
    // 인식 자료 구조와 승인된 처리 절차 버전의 대응 확인
    if (
        (run.schemaVersion === "perception-run-v1" &&
            input.pipelineVersion !== "video-local-observers-v1") ||
        (run.schemaVersion === "perception-run-v2" &&
            input.pipelineVersion !== "video-local-observers-av-v1")
    ) {
        // 처리 버전 불일치를 모든 후보의 보류 사유에 기록
        sharedReasons.push("PIPELINE_VERSION_UNVERIFIED");
    }
    // 승인된 각 모델의 고정 버전과 가중치 출처 순회
    for (const pin of Object.values(perceptionModelPins)) {
        // 실행 모델 목록에서 승인된 버전과 가중치 해시의 정확한 일치 확인
        if (
            !run.models.some(
                (model) =>
                    model.component === pin.component &&
                    model.modelId === pin.modelId &&
                    model.revision === pin.revision &&
                    model.weightsSha256 === pin.weightsSha256
            )
        )
            // 고정되지 않은 모델 출처를 공통 보류 사유에 기록
            sharedReasons.push("MODEL_PROVENANCE_UNPINNED");
    }
    // 경기 식별자와 검증 상태를 갖춘 규정 문맥만 선택
    const rule =
        input.rule?.verificationStatus === "VERIFIED" && input.rule.matchId ? input.rule : null;
    // 검증된 경기 문맥에 맞는 규정 집합 조회
    const rules = rule
        ? competitionSet({
              // 규정 적용 대상 대회
              competition: rule.competition,
              // 규정 적용 대상 시즌
              season: rule.season,
              // 국제 축구 규정 판본 식별자
              ifabVersionId: rule.ifabVersionId
          })
        : null;
    // 검증된 경기 규정이 없으면 모든 후보의 평가 보류
    if (!rules) sharedReasons.push("RULE_EDITION_UNVERIFIED");
    // 제출 순번으로 검증된 증거 참조를 찾는 조회표 생성
    const references = new Map(input.references.map((item) => [item.evidenceIndex, item]));
    // 각 후보의 근거와 규정을 대조한 자동 평가 목록 생성
    const rows = input.candidates.map((candidate): AutomaticReviewRow => {
        // 현재 후보의 평가 보류 사유에 공통 검사 결과 복사
        const reasons = [...sharedReasons];
        // 현재 후보 순번과 연결한 인식 사건 목록 추출
        const incidents = run.incidents.filter(
            (incident) => incident.candidateIndex === candidate.index
        );

        // 차단된 후보와 미충족 사유 기록
        const blocked = (extra: readonly string[]): AutomaticReviewRow => ({
            // 처리 결과에서 후보 장면을 찾는 순번
            candidateIndex: candidate.index,
            // 이번 규정 평가가 다루는 질문
            question: "PUSHING",
            // 처리 상태 또는 요청 응답 상태
            status: "BLOCKED",
            // 평가 불가 또는 처리 결과의 사유 코드 목록
            reasonCodes: [...new Set([...reasons, ...extra])],
            // 제출 목록에서 참조한 증거 순번 목록
            evidenceIndices: [],
            // 규정 사실을 생산한 방법과 검증 출처
            producer: null,
            // 경기 문맥에 맞춰 연결한 규정 자료
            rule,
            // 확인된 출처와 판본을 보존하는 규정 사실 자료
            facts: null,
            // 해당 단계의 처리 결과
            result: null
        });
        // 후보에 연결한 사건이 없거나 여러 개인 모호함 확인
        if (incidents.length !== 1)
            // 사건 미인식과 모호한 중복 연결을 구분한 보류 결과 반환
            return blocked([
                incidents.length ? "INCIDENT_LINK_AMBIGUOUS" : "INCIDENT_UNRECOGNIZED"
            ]);
        // 하나로 특정된 인식 사건 읽음
        const incident = incidents[0]!;
        // 사건 시간이 후보 및 실제 인식 범위를 벗어나는지 확인
        if (
            incident.startMs < candidate.startMs ||
            incident.endMs > candidate.endMs ||
            incident.startMs < run.coverage.startMs ||
            incident.endMs > run.coverage.endMs
        )
            // 인식 범위 이탈을 해당 후보의 보류 사유에 기록
            reasons.push("INCIDENT_COVERAGE_INVALID");
        // 지원 여부를 포함한 사실 생산 결과 보관 위치 마련
        let produced: AutomaticFacts;
        // 사실 생산 실패를 후보 보류로 분리하는 예외 경계 설정
        try {
            // 관측에서 지원 가능한 규정 사실을 등록 생산 기능으로 요청
            produced = dependencies.produce({ perception: run, candidate, incident });
        } catch {
            // 사실 생산 실패를 규정 판단으로 바꾸지 않고 보류 반환
            return blocked(["FACT_PRODUCER_FAILED"]);
        }
        // 사실 생산이 준비되지 않은 관측은 평가 보류
        if (produced.kind !== "READY") return blocked(produced.reasons);
        // 생산된 밀기 사실의 자료 계약을 통과하지 못하면 보류
        if (!pushFactsData(produced.facts)) return blocked(["FACT_SCHEMA_INVALID"]);
        // 실제 생산 방법이 검증된 등록 목록과 일치하는지 확인
        if (!dependencies.registry.some((method) => sameProducer(method, produced.producer)))
            // 검증되지 않은 사실 생산 방법을 보류 사유에 기록
            reasons.push("FACT_PRODUCER_UNVERIFIED");
        // 생산자가 참조한 증거 순번의 중복 제거
        const evidenceIndices = [...new Set(produced.evidenceIndices)];
        // 증거 참조가 없거나 인식 사건의 증거 밖을 참조하는지 확인
        if (
            !evidenceIndices.length ||
            evidenceIndices.some((index) => !incident.evidenceIndices.includes(index))
        )
            // 증거 참조 불일치를 후보 보류 사유에 기록
            reasons.push("EVIDENCE_UNVERIFIED");
        // 평가에서 참조한 순번의 서버 검증 증거 읽음
        const evidence = evidenceIndices.map((index) => references.get(index));
        // 같은 후보의 고정 증거와 사건 전체를 포함하는 클립 존재 확인
        if (
            evidence.some(
                (item) =>
                    !item ||
                    item.candidateIndex !== candidate.index ||
                    !item.immutable ||
                    !hash(item.contentSha256)
            ) ||
            !evidence.some(
                (item) =>
                    item?.kind === "CLIP" &&
                    item.startMs <= incident.startMs &&
                    item.endMs >= incident.endMs
            )
        ) {
            // 불변 증거 또는 사건 전체 클립 부족을 보류 사유에 기록
            reasons.push("EVIDENCE_UNVERIFIED");
        }
        // 하나라도 보류 사유가 있거나 규정이 없으면 평가 진행 차단
        if (reasons.length || !rules) return blocked([]);
        // 규정 계산 실패를 후보 보류로 분리하는 예외 경계 설정
        try {
            // 검증된 사실에 밀기 규정을 적용한 판단 계산
            const result = pushResult(produced.facts, rules);
            // 판단과 재개 및 징계와 규정 인용의 완료 조건 확인
            if (
                result.decision === "INCONCLUSIVE" ||
                result.decision === "OUT_OF_SCOPE" ||
                !result.restart ||
                result.disciplinary === null ||
                result.inconclusiveReason ||
                !result.citations.length
            ) {
                // 필수 결론이 완성되지 않은 규정 평가를 보류로 반환
                return blocked([result.inconclusiveReason ?? "RULE_EVALUATION_INCOMPLETE"]);
            }
            // 지원하는 밀기 질문의 완료 결과와 검증 사실 및 근거 반환
            return {
                // 처리 결과에서 후보 장면을 찾는 순번
                candidateIndex: candidate.index,
                // 이번 규정 평가가 다루는 질문
                question: "PUSHING",
                // 처리 상태 또는 요청 응답 상태
                status: "COMPLETED",
                // 평가 불가 또는 처리 결과의 사유 코드 목록
                reasonCodes: [],
                // 제출 목록에서 참조한 증거 순번 목록
                evidenceIndices,
                // 규정 사실을 생산한 방법과 검증 출처
                producer: produced.producer,
                // 경기 문맥에 맞춰 연결한 규정 자료
                rule,
                // 확인된 출처와 판본을 보존하는 규정 사실 자료
                facts: produced.facts,
                // 해당 단계의 처리 결과
                result
            };
        } catch {
            // 규정 계산 중 오류를 후보 보류로 반환
            return blocked(["RULE_EVALUATION_FAILED"]);
        }
    });
    // 후보별 완료와 보류 및 실제 영상 처리 범위를 분리하여 반환
    return {
        // 전달 자료 또는 평가 계약의 버전
        version: AUTOMATIC_REVIEW_VERSION,
        // 분석 기록의 식별자
        analysisId: input.analysisId,
        // 처리 작업의 식별자
        jobId: input.jobId,
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: input.jobRevision,
        // 분석한 원본 영상의 내용 해시
        sourceSha256: input.sourceSha256,
        // 영상 처리 절차를 구별하는 버전
        pipelineVersion: input.pipelineVersion,
        // 인식 처리가 실제 다룬 영상 범위
        videoCoverage: full ? "FULL" : "PARTIAL",
        // 요약 일부가 잘려 보존되지 않았는지 여부
        summaryTruncated: run.summary.truncated,
        // 완료된 반칙 규정 평가 수
        evaluatedCount: rows.filter((row) => row.status === "COMPLETED").length,
        // 근거 부족 등으로 평가가 막힌 후보 수
        blockedCount: rows.filter((row) => row.status === "BLOCKED").length,
        // 저장소 조회 행 또는 후보별 평가 목록
        rows
    };
};
