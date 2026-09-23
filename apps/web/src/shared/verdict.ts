// 규정 인용 자료형 가져오기
import type { RuleCitation } from "./citation";
// 공통 상태 값 목록 가져오기
import type { DecisionMatch, DisciplinaryAction, Severity, VarIntervention } from "./vocabulary";
// 사건 관측 자료형 가져오기
import type { IncidentAssertion } from "./incident";

// 개별 사실의 비공개 진단의 자료 구조 정의
export interface IncidentFactDiagnostic {
    // 개별 사실 식별자
    factId: string;
    // 현재 확인 상태
    state: IncidentAssertion["state"];
    // 시간 변화 근거가 필요한 질문인지 여부
    temporal: boolean;
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}

// 질문별 완료와 보류 결과의 자료 구조 정의
export type IncidentConclusion<T> =
    | Readonly<{
          // 현재 처리 상태
          status: "COMPLETED";
          // 값
          value: T;
          // 검증에 사용한 사실 식별자 목록
          factIds: readonly string[];
          // 연결된 증거 식별자 목록
          evidenceIds: readonly string[];
          // 결론에 연결된 규정 인용
          citations: readonly RuleCitation[];
      }>
    | Readonly<{
          // 현재 처리 상태
          status: "UNDETERMINED" | "UNSUPPORTED" | "NOT_APPLICABLE";
          // 값
          value: null;
          // 결론에 필요한 미확인 사실 목록
          missingFacts: readonly string[];
          // 처리 상태를 설명하는 사유 코드
          reasonCodes: readonly string[];
          // 결론에 연결된 규정 인용
          citations: readonly RuleCitation[];
      }>;

// 사건의 독립 질문별 평가 결과의 자료 구조 정의
export interface IncidentEvaluationV1 {
    // 전송 자료의 구조 버전
    schemaVersion: "incident-evaluation-v1";
    // 판정 계산기의 버전
    evaluatorVersion: "holding-criteria-v2";
    // 경합 사건 식별자
    incidentId: string;
    // 사건 안의 행위 식별자
    actionId: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 전체 사건 내용에 결합된 해시
    recordSha256: string;
    // 실제로 적용한 규정 판본 식별자
    ruleVersionId: string | null;
    // 현재 평가 범위
    scope: "HOLDING_ONLY";
    // 원시 주장이나 공개 결론과 구분된 비공개 근거 확인 결과
    factDiagnostics: readonly IncidentFactDiagnostic[];
    // 질문별로 분리된 규정 결론
    conclusions: {
        // 해당 유형의 반칙 성립 결론
        offence: IncidentConclusion<"HOLDING_OFFENCE" | "NO_HOLDING_OFFENCE">;
        // 행위 위험성의 규정상 평가
        risk: IncidentConclusion<Severity>;
        // 경기 재개에 관한 결과
        restart: IncidentConclusion<{
            // 자료 또는 행위 종류
            type: "DIRECT_FREE_KICK" | "PENALTY_KICK";
            // 재개를 부여받는 팀 식별자
            beneficiaryTeamId: string;
        }>;
        // 징계에 관한 독립 결과
        disciplinary: IncidentConclusion<DisciplinaryAction>;
        // 계산 결과와 원심의 비교
        originalDecisionComparison: IncidentConclusion<DecisionMatch>;
        // 비디오 판독 개입에 대한 별도 평가
        varIntervention: IncidentConclusion<VarIntervention>;
    };
}

// 독립적으로 평가할 질문의 자료 구조 정의
export type IncidentQuestion = keyof IncidentEvaluationV1["conclusions"];
