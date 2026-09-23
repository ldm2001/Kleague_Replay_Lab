// 평가 저장 명령
import type { EvaluationFacts } from "@replay/shared-types";
// 공유 자료 계약과 검증 기능 가져옴
import type { EvaluationResult } from "@replay/shared-types";

// 사실 수정 입력
export type FactPatchCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
    // 동시 수정 충돌 확인용 예상 사실 판본
    expectedFactRevisionId: string | null;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: EvaluationFacts;
    // 멱등 요청 키의 해시
    keyHash: Uint8Array;
    // 동일 키로 다른 요청을 보냈는지 확인하는 해시
    requestHash: Uint8Array;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 사실 결과 정의
export type FactPatchResult =
    | Readonly<{ kind: "CREATED" | "REPLAYED"; factRevisionId: string; revision: number }>
    | Readonly<{ kind: "STALE_FACT_REVISION" }>
    | Readonly<{ kind: "IDEMPOTENCY_KEY_REUSED" }>
    | Readonly<{ kind: "NOT_FOUND" }>;

// 판정 문맥 조회 입력
export type EvaluationContextCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 규정 평가 정의
export type EvaluationContext = Readonly<{
    // 분석 기록의 식별자
    analysisId: string;
    // 동시 변경을 감지하는 분석 상태 버전
    analysisStateVersion: number;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
    // 평가에 사용한 사실 판본 식별자
    factRevisionId: string;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: EvaluationFacts;
    // 대회 규정 판본 식별자
    ruleVersionId: string;
    // 저장소에서 규정 판본을 찾는 식별자
    ruleVersionDbId: string;
    // 규정 적용 대상 대회
    competition?: Readonly<{ competition: string; season: string }>;
    // 검증된 대회와 시즌의 규정 선택 자료
    competitionOptions: Readonly<Record<string, boolean | undefined>>;
}>;

// 규정 평가 결과 정의
export type EvaluationContextResult =
    | Readonly<{ kind: "READY"; value: EvaluationContext }>
    | Readonly<{ kind: "NO_FACTS" | "RULE_VERSION_UNAVAILABLE" | "NOT_FOUND" }>;

// 판정 저장 입력
export type DecisionSaveCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 동시 변경을 감지하는 분석 상태 버전
    analysisStateVersion: number;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
    // 평가에 사용한 사실 판본 식별자
    factRevisionId: string;
    // 대회 규정 판본 식별자
    ruleVersionId: string;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: EvaluationFacts;
    // 사실을 규정에 대조한 평가 결과
    evaluation: EvaluationResult;
    // 평가를 수행한 규정 엔진 버전
    ruleEngineVersion: string;
    // 평가 결과 자료 구조의 버전
    evaluationSchemaVersion: number;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 판단 결과 정의
export type DecisionSaveResult =
    | Readonly<{ kind: "CREATED" | "REPLAYED"; decisionId: string }>
    | Readonly<{
          // 처리 분기 또는 자료 종류를 구별하는 값
          kind:
              | "NOT_FOUND"
              | "FACT_NOT_FOUND"
              | "RULE_VERSION_UNAVAILABLE"
              | "STALE_FACT_REVISION"
              | "STALE_ANALYSIS";
      }>;

// 평가 저장 포트
export type EvaluationStore = Readonly<{
    // 사실 기록의 새 판본을 만드는 기능
    patch: (command: FactPatchCommand) => Promise<FactPatchResult>;
    // 소유권과 사실 및 규정 판본의 평가 문맥
    context: (command: EvaluationContextCommand) => Promise<EvaluationContextResult>;
    // 검사된 기록을 보존하는 기능
    save: (command: DecisionSaveCommand) => Promise<DecisionSaveResult>;
}>;
