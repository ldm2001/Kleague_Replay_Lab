import type { InteractionObservationV1, InteractionRecordLink } from "./interaction";
import type { IncidentRecordV1 } from "./incident";
import type { IncidentEvaluationV1 } from "./verdict";

// 관측과 사건 및 승인과 평가를 공개 응답에서 분리한 저장 계약
export interface PrivateIncidentRow {
    observation: InteractionObservationV1;
    observationSha256: string;
    record: IncidentRecordV1 | null;
    recordSha256: string | null;
    link: InteractionRecordLink | null;
    reasons: readonly string[];
    admittedFactIds: readonly string[];
    evaluations: readonly IncidentEvaluationV1[];
}

// 기존 작업 전송과 구별되는 서버 내부 색인 판본
export interface PrivateIncidentBatch {
    schemaVersion: "private-incidents-v1";
    sourceSha256: string;
    artifactSha256: string;
    rows: readonly PrivateIncidentRow[];
}
