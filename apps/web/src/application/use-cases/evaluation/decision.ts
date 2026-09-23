// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 사실과 규정을 대조하는 평가 기능 가져옴
import type {
    EvaluationStore,
    DecisionSaveResult
} from "../../ports/repositories/evaluation-store";
// 공유 자료 계약과 검증 기능 가져옴
import type { EvaluationResult } from "@replay/shared-types";
// 사실과 규정을 대조하는 평가 기능 가져옴
import type { AssessmentInput, AssessmentResult } from "./assessment";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 판정 입력
export type DecisionInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
}>;

// 판단 의존 기능 계약 정의
export type DecisionDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: EvaluationStore;
    // 관측 실행 자료 또는 평가 실행 기능
    run: (input: AssessmentInput) => Promise<AssessmentResult>;
}>;

// 판단 결과 정의
export type DecisionResult =
    | DecisionSaveResult
    | Readonly<{ kind: "INVALID_INPUT"; reason: "ID" }>
    | Readonly<{
          // 처리 분기 또는 자료 종류를 구별하는 값
          kind: "NO_FACTS" | "RULE_VERSION_UNKNOWN" | "EVALUATION_FAILED";
          // 처리 진행 또는 실패의 안내 문구
          message?: string;
      }>;

// 판정 처리
export const decision =
    ({ clock, repository, run }: DecisionDependencies) =>
    async (input: DecisionInput): Promise<DecisionResult> => {
        // 입력 식별자 검증
        if (
            ![input.anonymousSessionId, input.analysisId, input.candidateId].every((value) =>
                UUID.test(value)
            )
        ) {
            // 평가 요청 식별자 오류 반환
            return { kind: "INVALID_INPUT", reason: "ID" };
        }
        // 판정에 필요한 사실과 규정 조회
        const context = await repository.context({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId: input.anonymousSessionId.toLowerCase(),
            // 분석 기록의 식별자
            analysisId: input.analysisId.toLowerCase(),
            // 사실 또는 평가와 연결할 후보 식별자
            candidateId: input.candidateId.toLowerCase(),
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString()
        });
        // 판정 입력이 준비되지 않으면 원인 반환
        if (context.kind !== "READY") {
            // 사실 기록이 없는 평가 문맥을 별도 결과로 처리
            if (context.kind === "NO_FACTS") return { kind: "NO_FACTS" };
            // 적용 규정 판본을 확인하지 못한 문맥 구분
            if (context.kind === "RULE_VERSION_UNAVAILABLE")
                // 규정 판본 미확정 결과 반환
                return { kind: "RULE_VERSION_UNKNOWN" };
            // 대상 후보가 없는 평가 실행 실패 반환
            return { kind: "EVALUATION_FAILED", message: "candidate-not-found" };
        }
        // 규정 엔진 실행
        const result = await run({
            // 대회 규정 판본 식별자
            ruleVersionId: context.value.ruleVersionId,
            ...(context.value.competition ? { competition: context.value.competition } : {}),
            // 밀기 질문의 규정 평가 또는 사실 자료
            push: context.value.facts.push,
            // 영상 판독 적용 조건의 사실 자료
            variable: context.value.facts.variable,
            // 규정 판단과 비교하는 관측 원심
            observed: context.value.facts.observed,
            // 규정이나 저장소 실행에 필요한 선택 값
            options: context.value.competitionOptions
        });
        // 규정 엔진 결과 확인
        if (result.kind !== "EVALUATED") {
            // 규정 판본 미확정과 계산 실패를 구분하여 반환
            return result.kind === "RULE_VERSION_UNKNOWN"
                ? { kind: "RULE_VERSION_UNKNOWN" }
                : { kind: "EVALUATION_FAILED", message: result.message };
        }
        // 판정 결과 저장
        return repository.save({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId: input.anonymousSessionId.toLowerCase(),
            // 분석 기록의 식별자
            analysisId: input.analysisId.toLowerCase(),
            // 동시 변경을 감지하는 분석 상태 버전
            analysisStateVersion: context.value.analysisStateVersion,
            // 사실 또는 평가와 연결할 후보 식별자
            candidateId: input.candidateId.toLowerCase(),
            // 평가에 사용한 사실 판본 식별자
            factRevisionId: context.value.factRevisionId,
            // 대회 규정 판본 식별자
            ruleVersionId: context.value.ruleVersionDbId,
            // 확인된 출처와 판본을 보존하는 규정 사실 자료
            facts: context.value.facts,
            // 사실을 규정에 대조한 평가 결과
            evaluation: result.value as EvaluationResult,
            // 평가를 수행한 규정 엔진 버전
            ruleEngineVersion: "rule-engine-v3-judgment-contract",
            // 평가 결과 자료 구조의 버전
            evaluationSchemaVersion: 2,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString()
        });
    };
