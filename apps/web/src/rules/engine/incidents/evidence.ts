// 식별자와 해시 생성 도구 가져오기
import { createHash } from "node:crypto";
// 사건 관측 자료형 가져오기
import type {
    IncidentAction,
    IncidentAssertion,
    IncidentEvidence,
    IncidentRecordV1
} from "../../../shared/incident";
// 사건 구조 검증 기능 가져오기
import { incidentRecordData } from "../../../shared/incident-schema";

// 작업자 관측 기록과 분리된 서버 소유 승인 정보이며 신뢰도에서 승인 추정 금지
export interface IncidentAdmission {
    // 경합 사건 식별자
    incidentId: string;
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 전체 사건 내용에 결합된 해시
    recordSha256: string;
    // 검증에 사용한 사실 식별자 목록
    factIds: ReadonlySet<string>;
    // 증거 식별자별 확인된 해시
    evidenceHashes: ReadonlyMap<string, string>;
}

// 내용 순서 정규화
const canonical = (value: unknown): string => {
    // 배열 순서를 보존하며 각 원소를 해시용 문자열로 변환
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    // 객체 필드 순서를 정렬해 같은 내용이 같은 해시를 갖도록 정규화
    if (value !== null && typeof value === "object")
        // 정렬과 비교에 사용할 직렬화 내용 반환
        return `{${Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`;
    // 정렬과 비교에 사용할 직렬화 내용 반환
    return JSON.stringify(value);
};

// 사건 내용 해시
export const incidentDigest = (record: IncidentRecordV1): string => {
    // 사건 자료 구조 오류 시 오류로 처리 중단
    if (!incidentRecordData(record)) throw new Error("INCIDENT_RECORD_INVALID");
    // 동일한 내용을 비교할 해시값 반환
    return createHash("sha256").update(canonical(record)).digest("hex");
};

// 사건 승인 결합 확인
export const admissionMatch = (record: IncidentRecordV1, admission: IncidentAdmission): boolean =>
    admission.incidentId === record.incidentId && admission.sourceSha256 === record.sourceSha256 &&
    admission.recordSha256 === incidentDigest(record);

// 근거 검사 후 사실 상태의 자료 구조 정의
export interface IncidentAssertionRead {
    // 현재 확인 상태
    state: IncidentAssertion["state"];
    // 검증에 사용한 사실 식별자 목록
    factIds: readonly string[];
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 확인 불가 또는 차단 사유 목록
    reasons: readonly string[];
}

// 승인 사실과 근거 확인
export const incidentClaim = (
    record: IncidentRecordV1,
    action: IncidentAction,
    fact: IncidentAssertion,
    admission: IncidentAdmission,
    options: Readonly<{ temporal?: boolean; normalSpeed?: boolean }> = {}
): IncidentAssertionRead => {
    // 미확인 사실과 차단 사유 반환
    const unknown = (reason: string): IncidentAssertionRead => ({
        // 현재 확인 상태 기록
        state: "UNKNOWN",
        // 검증에 사용한 사실 식별자 목록 기록
        factIds: [],
        // 연결된 증거 식별자 목록 기록
        evidenceIds: [],
        // 확인 불가 또는 차단 사유 목록 기록
        reasons: [reason]
    });
    // 서버 승인과 사건 내용 불일치에 해당하는 경우 사유 기록
    if (!admissionMatch(record, admission)) return unknown("ADMISSION_RECORD_MISMATCH");
    // 입력 사건에 실제 포함된 행위 조회
    const ownedAction = record.actions.find((item) => item.id === action.id);
    // 사실과 소속 행위 불일치에 해당하는 경우 사유 기록
    if (!ownedAction || canonical(ownedAction) !== canonical(action))
        // 사실과 소속 행위 불일치 사유와 함께 결과 반환
        return unknown("ASSERTION_ACTION_MISMATCH");
    // 현재 행위에 실제 속한 사실 조회
    const owned = [
        ...Object.values(action.context),
        ...Object.values(action.observations),
        ...record.actors
            .filter((actor) => actor.id === action.actorId || actor.id === action.targetActorId)
            .map((actor) => actor.teamAssignment)
    ].find((item) => item.id === fact.id);
    // 사실과 소속 행위 불일치에 해당하는 경우 사유 기록
    if (!owned || canonical(owned) !== canonical(fact)) return unknown("ASSERTION_ACTION_MISMATCH");
    // 이미 미확인이거나 비적용인 사실은 원래 상태와 사유 유지
    if (fact.state === "UNKNOWN" || fact.state === "NOT_APPLICABLE")
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return { state: fact.state, factIds: [], evidenceIds: [], reasons: fact.reasons };
    // 서버가 승인하지 않은 사실에 해당하는 경우 사유 기록
    if (!admission.factIds.has(fact.id)) return unknown("FACT_NOT_ADMITTED");
    // 식별자로 조회할 근거 목록 보관 공간 생성
    const byId = new Map(record.evidence.map((item) => [item.id, item]));
    // 식별자로 조회할 영상 구간 보관 공간 생성
    const segments = new Map(record.segments.map((item) => [item.id, item]));
    // 관련 영상 근거 목록 초기화
    const evidence: IncidentEvidence[] = [];
    // 다른 시점 연결을 뒷받침한 사실 식별자 초기화
    const linkedFacts: string[] = [];
    // 다른 시점 연결을 뒷받침한 영상 근거 초기화
    const linkedEvidence: string[] = [];
    // 연결된 증거 식별자 목록의 각 항목을 순서대로 검사
    for (const id of fact.evidenceIds) {
        // 사실에 연결된 증거 식별자로 원본 근거 조회
        const item = byId.get(id);
        // 증거 내용 해시 미확인에 해당하는 경우 사유 기록
        if (!item || admission.evidenceHashes.get(id) !== item.contentSha256)
            // 증거 내용 해시 미확인 사유와 함께 결과 반환
            return unknown("EVIDENCE_HASH_UNVERIFIED");
        // 관측 영상 구간 식별자의 조건에 따라 처리 분기
        if (item.segmentId !== action.segmentId) {
            // 다른 영상 구간과 동일 사건임을 연결한 근거 조회
            const link = record.links.find(
                (link) =>
                    link.relation === "SAME_INCIDENT" &&
                    ((link.firstSegmentId === action.segmentId &&
                        link.secondSegmentId === item.segmentId) ||
                        (link.secondSegmentId === action.segmentId &&
                            link.firstSegmentId === item.segmentId)) &&
                    link.assessment.state === "CONFIRMED" &&
                    admission.factIds.has(link.assessment.id) &&
                    link.assessment.evidenceIds.every(
                        (proofId) =>
                            byId.has(proofId) &&
                            admission.evidenceHashes.get(proofId) ===
                                byId.get(proofId)!.contentSha256
                    ) &&
                    [action.segmentId, item.segmentId].every((segmentId) =>
                        link.assessment.evidenceIds.some(
                            (proofId) => byId.get(proofId)?.segmentId === segmentId
                        )
                    )
            );
            // 서로 다른 시점의 사건 연결 미확인에 해당하는 경우 사유 기록
            if (!link) return unknown("VIEW_LINK_UNVERIFIED");
            // 다른 시점 연결을 뒷받침한 사실 식별자 목록에 현재 항목 추가
            linkedFacts.push(link.assessment.id);
            // 다른 시점 연결을 뒷받침한 영상 근거 목록에 현재 항목 추가
            linkedEvidence.push(...link.assessment.evidenceIds);
        } else if (item.endMs < action.startMs || item.startMs > action.endMs)
            // 행위 구간 밖의 증거 사유와 함께 결과 반환
            return unknown("EVIDENCE_OUTSIDE_ACTION");
        // 관련 영상 근거 목록 목록에 현재 항목 추가
        evidence.push(item);
    }
    // 질문에 필요한 속도와 시각 조건을 충족한 근거 조회
    const eligible = options.normalSpeed
        ? evidence.filter((item) => segments.get(item.segmentId)?.playbackSpeed === "NORMAL")
        : evidence;
    // 정상 재생 속도 근거 부족에 해당하는 경우 사유 기록
    if (!eligible.length)
        // 정상 재생 속도 근거 부족 사유와 함께 결과 반환
        return unknown(options.normalSpeed ? "NORMAL_SPEED_REQUIRED" : "EVIDENCE_MISSING");
    // 전체 시간 구간의 근거 부족에 해당하는 경우 사유 기록
    if (
        options.temporal &&
        !eligible.some((item) => {
            // 근거가 속한 원본 구간 조회
            const segment = segments.get(item.segmentId)!;
            // 검사할 시작 시각 계산
            const start = item.segmentId === action.segmentId ? action.startMs : segment.startMs;
            // 검사할 종료 시각 계산
            const end = item.segmentId === action.segmentId ? action.endMs : segment.endMs;
            // 결과 종류 및 원본 기준 시작 시각를 반영한 결과 반환
            return item.kind === "CLIP" && item.startMs <= start && item.endMs >= end;
        })
    ) {
        // 전체 시간 구간의 근거 부족 사유와 함께 결과 반환
        return unknown("TEMPORAL_COVERAGE_INSUFFICIENT");
    }
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 현재 확인 상태 기록
        state: fact.state,
        // 검증에 사용한 사실 식별자 목록 기록
        factIds: [fact.id, ...new Set(linkedFacts)],
        // 연결된 증거 식별자 목록 기록
        evidenceIds: [...new Set([...eligible.map((item) => item.id), ...linkedEvidence])],
        // 확인 불가 또는 차단 사유 목록 기록
        reasons: []
    };
};
