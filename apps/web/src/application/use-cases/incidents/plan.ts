import { incidentDigest } from "@replay/rule-engine";
import {
    incidentLineage,
    interactionData,
    PRIVATE_INDEX_BYTES,
    PRIVATE_INDEX_ROWS,
    type IncidentEvaluationV1,
    type IncidentMatch,
    type IncidentRecordV1,
    type InteractionObservationV1,
    type InteractionRecordLink,
    type PrivateIncidentBatch,
    type PrivateIncidentRow
} from "@replay/shared-types";
import type { AnalysisEvidence } from "../../ports/repositories/job-store";
import { incidentEvaluation } from "./admission";
import { observationDigest } from "./batch";

// 저장 경계가 대조하는 현재 작업의 원본과 산출물 및 증거 문맥
export type IncidentPlanContext = Readonly<{
    // 현재 분석 원본 영상의 내용 해시
    sourceSha256: string;
    // 비공개 관측 산출물의 내용 해시
    artifactSha256: string;
    // 결과 저장 요청에 담긴 증거 목록
    evidence: readonly AnalysisEvidence[];
}>;

// 저장 시점에 잠근 검증 규정과 적용 기간이 맞는 현재 경기 문맥
export type VerifiedMatch = Readonly<{
    // 분석에 연결된 경기 식별자
    matchId: string;
    // 경기가 속한 대회
    competition: string;
    // 대회 시즌
    season: string;
    // 경기 날짜
    matchDate: string;
    // 적용 규정의 국제 경기 규칙 판본 식별자
    ifabVersionId: string;
}>;

// 저장 트랜잭션이 잠금 상태에서 다시 읽는 현재 검증 경기 조회
export type IncidentMatchRead = () => Promise<VerifiedMatch | undefined>;

// 서버 방법으로 다시 평가한 유형별 사건 저장 내용
export type IncidentPlanRecord = Readonly<{
    // 검증을 마친 유형별 사건
    value: IncidentRecordV1;
    // 서버가 다시 계산한 사건 내용 해시
    recordSha256: string;
    // 관측과 사건을 잇는 계보
    link: InteractionRecordLink;
    // 서버 방법이 승인한 사실 식별자 목록
    factIds: readonly string[];
    // 승인된 사실로 계산한 질문별 평가 목록
    evaluations: readonly IncidentEvaluationV1[];
}>;

// 모든 검증을 통과한 비공개 관측 저장 행
export type IncidentPlanRow = Readonly<{
    // 검증을 마친 일반 상호작용 관측
    observation: InteractionObservationV1;
    // 관측 내용에 결합된 저장 해시
    observationSha256: string;
    // 관측 보류 사유 목록
    reasons: readonly string[];
    // 유형별 사건 저장 내용 또는 사건 없음
    record: IncidentPlanRecord | null;
}>;

// 결과 제출과 저장 경계가 함께 쓰는 비공개 색인 행 수와 직렬화 바이트 상한 확인
export const boundedBatch = (batch: PrivateIncidentBatch) =>
    batch.rows.length <= PRIVATE_INDEX_ROWS
    && Buffer.byteLength(JSON.stringify(batch)) <= PRIVATE_INDEX_BYTES;

// 배치 판본과 원본 및 산출물 결합과 용량 상한 확인
const validEnvelope = (batch: PrivateIncidentBatch, context: IncidentPlanContext) =>
    batch.schemaVersion === "private-incidents-v1"
    && batch.sourceSha256 === context.sourceSha256
    && batch.artifactSha256 === context.artifactSha256
    && typeof batch.truncated === "boolean"
    && boundedBatch(batch);

// 선언된 검증 경기가 저장 시점에 잠근 현재 검증 경기와 같은지 확인
const sameMatch = (declared: IncidentMatch, current: VerifiedMatch | undefined) =>
    current !== undefined
    && declared.matchId === current.matchId
    && declared.matchDate === current.matchDate
    && declared.competition === current.competition
    && declared.season === current.season
    && declared.ifabVersionId === current.ifabVersionId;

// 관측의 모든 증거 참조가 저장 시점의 증거 목록과 같은지 확인
const sameEvidence = (observation: InteractionObservationV1, evidence: readonly AnalysisEvidence[]) =>
    observation.evidence.every((reference) => {
        // 참조 순번이 가리키는 실제 제출 증거 읽음
        const actual = evidence[reference.evidenceIndex];
        // 종류와 내용 해시 및 시간 구간 일치 확인
        return actual !== undefined
            && actual.kind === reference.kind
            && actual.contentSha256 === reference.contentSha256
            && actual.startMs === reference.startMs
            && actual.endMs === reference.endMs;
    });

// 사건 원본과 내용 해시 및 관측 계보를 서버 재계산과 대조한 저장 계보 반환
const recordLineage = (row: PrivateIncidentRow, record: IncidentRecordV1, source: string) => {
    // 원본이 다른 사건은 내용 해시 계산 전 거부
    if (record.sourceSha256 !== source) throw new Error("INCIDENT_ROW_LINEAGE_MISMATCH");
    // 사건 내용 해시 서버 재계산
    const recordSha256 = incidentDigest(record);
    // 저장 요청이 전달한 계보 읽음
    const link = row.link;
    // 내용 해시와 계보 존재 및 관측으로 다시 만든 계보 대조
    if (
        row.recordSha256 !== recordSha256
        || !link
        || JSON.stringify(incidentLineage(row.observation, record, link.actionId)) !== JSON.stringify(link)
    ) {
        throw new Error("INCIDENT_ROW_LINEAGE_MISMATCH");
    }
    return { recordSha256, link };
};

// 사건이 주장한 증거 해시를 자기 증명으로 쓰지 않고 검증된 원래 관측 증거에 결합
const recordEvidence = (observation: InteractionObservationV1, record: IncidentRecordV1) => {
    // 사건 증거 식별자별 검증된 내용 해시 대응표 생성
    const verified = new Map<string, string>();
    // 사건 증거 순회
    for (const item of record.evidence) {
        // 종류와 해시 및 시간 구간이 같은 관측 증거 탐색
        const reference = observation.evidence.find((entry) =>
            entry.kind === item.kind
            && entry.contentSha256 === item.contentSha256
            && (entry.kind === "FRAME"
                ? item.startMs === entry.timestampMs && item.endMs === entry.timestampMs
                : item.startMs === entry.startMs && item.endMs === entry.endMs));
        // 대응하는 관측 증거가 없는 사건 증거 거부
        if (!reference) throw new Error("INCIDENT_RECORD_EVIDENCE_MISMATCH");
        // 사건 증거 식별자에 관측 증거 해시 결합
        verified.set(item.id, reference.contentSha256);
    }
    return verified;
};

// 저장 요청의 승인과 평가를 신뢰하지 않고 검증된 증거와 잠근 경기 문맥으로 다시 계산한 저장 계획 반환
export async function incidentPlan(
    batch: PrivateIncidentBatch,
    context: IncidentPlanContext,
    currentMatch: IncidentMatchRead
): Promise<readonly IncidentPlanRow[]> {
    // 배치 판본과 원본 결합 및 용량 상한 위반 거부
    if (!validEnvelope(batch, context)) throw new Error("INCIDENT_BATCH_INVALID");
    // 검증 경기를 선언한 사건이 있을 때만 현재 경기 문맥 잠금 조회
    const match = batch.rows.some((row) => row.record?.match.verification === "VERIFIED")
        ? await currentMatch()
        : undefined;
    // 중복 관측 식별자 확인용 집합
    const ids = new Set<string>();
    // 저장 순서를 보존한 검증 완료 행 목록
    const plan: IncidentPlanRow[] = [];
    // 배치 행 순회
    for (const row of batch.rows) {
        // 행의 일반 상호작용 관측 읽음
        const observation = row.observation;
        // 관측 구조와 원본 및 내용 해시와 중복 및 외부 승인과 평가 혼입 거부
        if (
            !interactionData(observation)
            || observation.sourceSha256 !== context.sourceSha256
            || row.observationSha256 !== observationDigest(observation)
            || ids.has(observation.observationId)
            || "admittedFactIds" in row
            || "evaluations" in row
        ) {
            throw new Error("INCIDENT_ROW_INVALID");
        }
        // 확인한 관측 식별자 기록
        ids.add(observation.observationId);
        // 검증 경기를 선언한 사건과 현재 잠근 경기 문맥 대조
        if (row.record?.match.verification === "VERIFIED" && !sameMatch(row.record.match, match)) {
            throw new Error("INCIDENT_RULE_CONTEXT_CHANGED");
        }
        // 저장 시점의 증거 목록과 관측의 모든 참조 대조
        if (!sameEvidence(observation, context.evidence)) throw new Error("INCIDENT_ROW_EVIDENCE_MISMATCH");
        // 유형별 사건이 없는 관측 행 계획
        if (!row.record) {
            plan.push({ observation, observationSha256: row.observationSha256, reasons: row.reasons, record: null });
            continue;
        }
        // 사건 원본과 내용 해시 및 관측 계보 검증
        const lineage = recordLineage(row, row.record, context.sourceSha256);
        // 검증된 관측 증거에 결합한 사건 증거로 서버 방법 평가
        const evaluated = incidentEvaluation(row.record, recordEvidence(observation, row.record));
        // 서버가 다시 계산한 승인과 평가를 담은 사건 행 계획
        plan.push({
            observation,
            observationSha256: row.observationSha256,
            reasons: row.reasons,
            record: {
                value: row.record,
                recordSha256: lineage.recordSha256,
                link: lineage.link,
                factIds: [...evaluated.admission.factIds],
                evaluations: evaluated.evaluations
            }
        });
    }
    return plan;
}
