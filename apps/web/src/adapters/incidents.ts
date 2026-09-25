import { sql } from "drizzle-orm";
import type { DatabaseClient } from "../database";
import type { PrivateIncidentBatch } from "../shared/private-incidents";
import { interactionData, incidentLineage } from "../shared/interaction";
import { incidentDigest } from "../rules/engine/incidents/evidence";
import { observationDigest } from "../application/use-cases/incidents/batch";
import { incidentEvaluation } from "../application/use-cases/incidents/admission";
import type { AnalysisEvidence } from "../application/ports/repositories/job-store";

// 기존 결과 저장 트랜잭션만 전달받는 비공개 관측 저장 경계
export async function incidentRows(
    transaction: Pick<DatabaseClient["db"], "execute">,
    batch: PrivateIncidentBatch,
    context: { analysisId: string; jobId: string; jobRevision: number; sourceSha256: string;
        artifactSha256: string; now: string; expiresAt: string; evidence: readonly AnalysisEvidence[] }
) {
    if (batch.schemaVersion !== "private-incidents-v1" || batch.sourceSha256 !== context.sourceSha256
        || batch.artifactSha256 !== context.artifactSha256 || batch.rows.length > 10000
        || Buffer.byteLength(JSON.stringify(batch)) > 32 * 1024 * 1024) throw new Error("INCIDENT_BATCH_INVALID");
    const ids = new Set<string>();
    // 등록된 경기와 적용 기간에 맞는 규정 문맥을 잠금 상태에서 다시 읽음
    const matches = batch.rows.some((row) => row.record?.match.verification === "VERIFIED")
        ? await transaction.execute(sql`
            select m.id as match_id, m.match_date::text as match_date, r.competition, r.season, r.ifab_edition
            from analyses a join matches m on m.id = a.match_id
            join competition_rule_versions r on r.id = a.applied_rule_version_id
            where a.id = ${context.analysisId} and r.verification_status = 'VERIFIED'
              and m.competition = r.competition and m.season = r.season
              and m.match_date >= r.effective_from and (r.effective_to is null or m.match_date <= r.effective_to)
              and nullif(trim(r.source_document), '') is not null
            for share of m, r
        `) : [];
    const [match] = matches as unknown as Array<{ match_id: string; match_date: string; competition: string; season: string; ifab_edition: string }>;
    for (const row of batch.rows) {
        const observation = row.observation;
        if (!interactionData(observation) || observation.sourceSha256 !== context.sourceSha256
            || row.observationSha256 !== observationDigest(observation) || ids.has(observation.observationId)
            || row.admittedFactIds.length) throw new Error("INCIDENT_ROW_INVALID");
        ids.add(observation.observationId);
        if (row.record?.match.verification === "VERIFIED") {
            const declared = row.record.match;
            if (!match || declared.matchId !== match.match_id || declared.matchDate !== match.match_date
                || declared.competition !== match.competition || declared.season !== match.season
                || declared.ifabVersionId !== `ifab-${match.ifab_edition}`) throw new Error("INCIDENT_RULE_CONTEXT_CHANGED");
        }
        // 저장 시점의 증거 목록과 관측의 모든 참조를 다시 대조
        for (const reference of observation.evidence) {
            const actual = context.evidence[reference.evidenceIndex];
            if (!actual || actual.kind !== reference.kind || actual.contentSha256 !== reference.contentSha256
                || actual.startMs !== reference.startMs || actual.endMs !== reference.endMs) {
                throw new Error("INCIDENT_ROW_EVIDENCE_MISMATCH");
            }
        }
        if (row.record && (row.record.sourceSha256 !== context.sourceSha256
            || row.recordSha256 !== incidentDigest(row.record) || !row.link
            || JSON.stringify(incidentLineage(observation, row.record, row.link.actionId)) !== JSON.stringify(row.link))) {
            throw new Error("INCIDENT_ROW_LINEAGE_MISMATCH");
        }
        // 사건이 주장한 해시를 자기 증명으로 쓰지 않고 검증된 원래 관측에 결합
        const verifiedRecordEvidence = new Map<string, string>();
        for (const item of row.record?.evidence ?? []) {
            const reference = observation.evidence.find((entry) => entry.kind === item.kind
                && entry.contentSha256 === item.contentSha256
                && (entry.kind === "FRAME"
                    ? item.startMs === entry.timestampMs && item.endMs === entry.timestampMs
                    : item.startMs === entry.startMs && item.endMs === entry.endMs));
            if (!reference) throw new Error("INCIDENT_RECORD_EVIDENCE_MISMATCH");
            verifiedRecordEvidence.set(item.id, reference.contentSha256);
        }
        const inserted = await transaction.execute(sql`
            insert into analysis_incident_observations
                (analysis_id, job_id, job_revision, source_sha256, artifact_sha256, schema_version,
                 observation_id, candidate_id, content_sha256, observation, reasons, created_at, expires_at)
            values (${context.analysisId}, ${context.jobId}, ${context.jobRevision},
                ${Buffer.from(context.sourceSha256, "hex")}, ${Buffer.from(context.artifactSha256, "hex")},
                ${batch.schemaVersion}, ${observation.observationId}, ${observation.candidateId},
                ${Buffer.from(row.observationSha256, "hex")}, ${JSON.stringify(observation)}::jsonb,
                ${JSON.stringify(row.reasons)}::jsonb, ${context.now}, ${context.expiresAt}) returning id
        `);
        if (row.record) {
            const [saved] = inserted as unknown as Array<{ id: string }>;
            if (!saved) throw new Error("INCIDENT_ROW_NOT_SAVED");
            // 저장 요청에 섞인 승인과 평가를 신뢰하지 않고 서버 방법으로 다시 평가
            const evaluated = incidentEvaluation(row.record, verifiedRecordEvidence);
            await transaction.execute(sql`
                insert into analysis_incident_records
                    (observation_id, incident_id, content_sha256, record, lineage, admitted_fact_ids, evaluations)
                values (${saved.id}, ${row.record.incidentId}, ${Buffer.from(row.recordSha256!, "hex")},
                    ${JSON.stringify(row.record)}::jsonb, ${JSON.stringify(row.link)}::jsonb,
                    ${JSON.stringify([...evaluated.admission.factIds])}::jsonb, ${JSON.stringify(evaluated.evaluations)}::jsonb)
            `);
        }
    }
}

// 분석 소유 범위와 현재 작업 판본 및 원본 보존 기한을 확인한 내부 조회
export async function incidentQuery(
    database: Pick<DatabaseClient, "db">,
    input: { analysisId: string; anonymousSessionId: string; after: string | null; limit: number },
    now: string
) {
    const owner = await database.db.execute(sql`
        select a.id from analyses a
        join video_assets v on v.id = a.video_asset_id
        join anonymous_sessions s on s.id = a.anonymous_session_id
        where a.id = ${input.analysisId} and s.id = ${input.anonymousSessionId}
          and a.status = 'COMPLETED' and v.status = 'VALID'
          and a.expires_at > ${now} and v.expires_at > ${now} and s.expires_at > ${now}
        limit 1
    `);
    if (!(owner as unknown as unknown[]).length) return null;
    const rows = await database.db.execute(sql`
        select o.id, o.job_id, o.job_revision, o.observation, o.reasons,
            r.record, r.lineage, r.admitted_fact_ids, r.evaluations
        from analysis_incident_observations o
        join analyses a on a.id = o.analysis_id
        join video_assets v on v.id = a.video_asset_id
        join anonymous_sessions s on s.id = a.anonymous_session_id
        join processing_jobs j on j.id = o.job_id
        left join analysis_incident_records r on r.observation_id = o.id
        where a.id = ${input.analysisId} and s.id = ${input.anonymousSessionId}
          and a.status = 'COMPLETED' and v.status = 'VALID' and j.status = 'SUCCEEDED'
          and j.job_revision = o.job_revision and o.source_sha256 = a.source_fingerprint
          and o.source_sha256 = v.content_sha256
          and a.expires_at > ${now} and v.expires_at > ${now} and s.expires_at > ${now} and o.expires_at > ${now}
          and (${input.after}::uuid is null or o.id > ${input.after}::uuid)
        order by o.id limit ${input.limit + 1}
    `);
    const items = rows as unknown as Array<Record<string, unknown> & { id: string }>;
    return { schemaVersion: "private-incidents-v1", rows: items.slice(0, input.limit),
        next: items.length > input.limit ? items[input.limit - 1]!.id : null };
}
