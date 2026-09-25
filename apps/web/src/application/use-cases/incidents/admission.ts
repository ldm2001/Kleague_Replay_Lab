import type { IncidentAssertion, IncidentRecordV1 } from "../../../shared/incident";
import { incidentRecordData } from "../../../shared/incident-schema";
import { incidentDigest, type IncidentAdmission } from "../../../rules/engine/incidents/evidence";
import { holdingVerdict, incidentPublic } from "../../../rules/engine/incidents/holding";
import { ruleSet } from "../../../rules/data";

// 서버 코드에서만 등록하는 사실별 검증 방법 계약
export interface IncidentMethod {
    id: string;
    version: string;
    validationReportSha256: string;
    factKeys: readonly string[];
}

// 실영상 사실별 검증을 통과한 운영 방법은 아직 없으므로 승인 목록 봉쇄
const operating: readonly IncidentMethod[] = Object.freeze([]);

// 실제 근거 해시와 서버 고정 방법이 일치하는 개별 사실만 승인
export function incidentAdmission(
    record: IncidentRecordV1,
    evidenceHashes: ReadonlyMap<string, string>,
    methods: readonly IncidentMethod[] = operating
): IncidentAdmission {
    if (!incidentRecordData(record)) throw new Error("INCIDENT_RECORD_INVALID");
    // 원본과 내용이 같은 사건에만 재사용할 승인 식별자 구성
    const factIds = new Set<string>();
    const evidence = new Map(record.evidence.map((item) => [item.id, item.contentSha256]));
    const verified = new Map([...evidenceHashes].filter(([id, hash]) => evidence.get(id) === hash));

    // 관측 신뢰도 대신 방법과 질문 범위 및 검증된 근거 존재 확인
    const candidate = (key: string, fact: IncidentAssertion) => {
        if (!["CONFIRMED", "REFUTED"].includes(fact.state)
            || !fact.evidenceIds.length || !fact.evidenceIds.every((id) => verified.has(id))) return;
        if (methods.some((method) => method.id === fact.method.id && method.version === fact.method.version
            && /^[a-f0-9]{64}$/.test(method.validationReportSha256) && method.factKeys.includes(key))) {
            factIds.add(fact.id);
        }
    };
    for (const action of record.actions) {
        for (const [key, fact] of Object.entries(action.context)) candidate(`context.${key}`, fact);
        for (const [key, fact] of Object.entries(action.observations)) candidate(`observations.${key}`, fact);
    }
    for (const actor of record.actors) candidate("teamAssignment", actor.teamAssignment);
    for (const link of record.links) candidate(`link.${link.relation}`, link.assessment);
    return { incidentId: record.incidentId, sourceSha256: record.sourceSha256,
        recordSha256: incidentDigest(record), factIds, evidenceHashes: verified };
}

// 사실 승인을 거친 질문별 잡기 평가와 완료 전용 투영 생성
export function incidentEvaluation(
    record: IncidentRecordV1,
    evidenceHashes: ReadonlyMap<string, string>,
    methods: readonly IncidentMethod[] = operating
) {
    const admission = incidentAdmission(record, evidenceHashes, methods);
    // 규정 판본 부재를 기본 판본으로 채우지 않음
    const rules = record.match.ifabVersionId ? ruleSet(record.match.ifabVersionId) : null;
    const evaluations = rules ? record.actions.map((action) => holdingVerdict(record, action.id, { rules, admission })) : [];
    return {
        admission,
        evaluations,
        reasons: rules ? [] : ["RULE_CONTEXT_UNAVAILABLE"],
        // 원시 관측과 사실 승인 진단을 공개 투영에서 제외
        publicResults: evaluations.map(incidentPublic).filter((value) => value.conclusions.length > 0)
    };
}
