import { createHash } from "node:crypto";
import type { AnalysisPayload } from "../../ports/repositories/job-store";
import type { CompletionStorage } from "../../ports/storage/upload-storage";
import type { IncidentArchive } from "./archive";
import type { PrivateIncidentBatch, PrivateIncidentRow } from "../../../shared/private-incidents";
import { incidentRecord } from "./record";
import { incidentEvaluation } from "./admission";
import { incidentDigest } from "../../../rules/engine/incidents/evidence";
import type { IncidentMatch } from "../../../shared/incident";

// 비공개 관측의 직렬화 내용에 결합된 저장 해시 반환
export const observationDigest = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");

// 일반 관측의 모든 미디어 참조를 현재 작업의 실제 저장 파일과 대조
export async function incidentBatch(
    archive: IncidentArchive, payload: AnalysisPayload,
    context: { analysisId: string; jobId: string; jobRevision: number; match?: IncidentMatch },
    storage: CompletionStorage
): Promise<PrivateIncidentBatch> {
    const verified = new Set<number>();
    const rows: PrivateIncidentRow[] = [];
    for (const observation of archive.observations) {
        for (const reference of observation.evidence) {
            const entry = payload.evidence?.[reference.evidenceIndex];
            if (!entry || entry.kind !== reference.kind || entry.startMs !== reference.startMs
                || entry.endMs !== reference.endMs || entry.contentSha256 !== reference.contentSha256) {
                throw new Error("INCIDENT_EVIDENCE_REFERENCE_MISMATCH");
            }
            // 다른 작업과 다른 판본의 파일을 근거로 승인하지 않음
            const prefix = `evidence/${context.analysisId}/${context.jobId}/${context.jobRevision}/${entry.contentSha256}/`;
            if (!entry.objectKey.startsWith(prefix)
                || entry.objectKey.slice(prefix.length) !== reference.path.split("/").at(-1)) {
                throw new Error("INCIDENT_EVIDENCE_PATH_MISMATCH");
            }
            if (!verified.has(reference.evidenceIndex)) {
                const actual = await storage.head(entry.objectKey, 50 * 1024 * 1024);
                if (!actual || Buffer.from(actual.contentSha256).toString("hex") !== reference.contentSha256) {
                    throw new Error("INCIDENT_EVIDENCE_HASH_MISMATCH");
                }
                verified.add(reference.evidenceIndex);
            }
        }
        // 실제 검증된 미디어가 연결된 후보만 사건 변환기에 전달
        const conversion = incidentRecord(observation);
        if (conversion.kind === "UNRESOLVED") {
            rows.push({ observation: conversion.observation, observationSha256: observationDigest(conversion.observation),
                record: null, recordSha256: null, link: null, reasons: [...conversion.reasons, "UPSTREAM_PROVENANCE_UNVERIFIED"],
                admittedFactIds: [], evaluations: [] });
            continue;
        }
        const record = { ...conversion.record, ...(context.match ? { match: context.match } : {}) };
        // 구조나 파일 검증만으로 사실 승인 목록을 채우지 않음
        const evaluation = incidentEvaluation(record, new Map(record.evidence.map((item) => [item.id, item.contentSha256])));
        rows.push({ observation: conversion.observation, observationSha256: observationDigest(conversion.observation),
            record, recordSha256: incidentDigest(record), link: conversion.link,
            reasons: [...evaluation.reasons, "UPSTREAM_PROVENANCE_UNVERIFIED"],
            admittedFactIds: [...evaluation.admission.factIds], evaluations: evaluation.evaluations });
    }
    return { schemaVersion: "private-incidents-v1", sourceSha256: archive.sourceSha256,
        artifactSha256: archive.artifactSha256, rows };
}
