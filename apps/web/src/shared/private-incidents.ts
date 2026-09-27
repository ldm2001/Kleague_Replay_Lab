import type { InteractionObservationV1, InteractionRecordLink } from "./interaction";
import type { IncidentRecordV1 } from "./incident";

// 관측과 사건을 공개 응답에서 분리하고 승인과 평가는 저장 경계가 계산하는 저장 계약
export interface PrivateIncidentRow {
    observation: InteractionObservationV1;
    observationSha256: string;
    record: IncidentRecordV1 | null;
    recordSha256: string | null;
    link: InteractionRecordLink | null;
    reasons: readonly string[];
}

// 한 번의 결과 저장에서 비공개 색인이 수용하는 행 수와 직렬화 바이트 상한
export const PRIVATE_INDEX_ROWS = 10_000;
export const PRIVATE_INDEX_BYTES = 32 * 1024 * 1024;

// 기존 작업 전송과 구별되는 서버 내부 색인 판본
export interface PrivateIncidentBatch {
    schemaVersion: "private-incidents-v1";
    sourceSha256: string;
    artifactSha256: string;
    // 생산자 예산으로 일부 관측만 기록한 산출물 표시
    truncated: boolean;
    rows: readonly PrivateIncidentRow[];
}

// 색인 저장과 용량 또는 시한 초과로 생략한 색인을 구분하는 저장 명령
export type PrivateIndex =
    | Readonly<{ status: "INDEXED"; batch: PrivateIncidentBatch }>
    | Readonly<{ status: "SKIPPED"; reason: "PRIVATE_INDEX_CAPACITY" | "PRIVATE_INDEX_TIMEOUT" }>;
