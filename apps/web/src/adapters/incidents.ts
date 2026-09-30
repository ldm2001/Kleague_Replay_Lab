import { sql } from "drizzle-orm";
import { incidentPlan, type AnalysisEvidence, type VerifiedMatch } from "@replay/application";
import type { DatabaseClient } from "@replay/database";
import type { PrivateIncidentBatch } from "@replay/shared-types";
import { activeSession, CONSISTENT_READ, liveAnalysis, liveVideo } from "./visibility";

// 기존 결과 저장 트랜잭션만 전달받는 비공개 관측 저장 경계
export async function incidentRows(
    transaction: Pick<DatabaseClient["db"], "execute">,
    batch: PrivateIncidentBatch,
    context: {
        analysisId: string;
        jobId: string;
        jobRevision: number;
        sourceSha256: string;
        artifactSha256: string;
        now: string;
        expiresAt: string;
        evidence: readonly AnalysisEvidence[];
    }
) {
    // 등록된 경기와 적용 기간에 맞는 규정 문맥을 같은 트랜잭션의 공유 잠금으로 다시 읽는 조회
    const currentMatch = async (): Promise<VerifiedMatch | undefined> => {
        // 검증된 적용 규정과 경기 행 잠금 조회
        const rows = await transaction.execute(sql`
            select m.id as match_id, m.match_date::text as match_date, r.competition, r.season, r.ifab_edition
            from analyses a join matches m on m.id = a.match_id
            join competition_rule_versions r on r.id = a.applied_rule_version_id
            where a.id = ${context.analysisId} and r.verification_status = 'VERIFIED'
              and m.competition = r.competition and m.season = r.season
              and m.match_date >= r.effective_from and (r.effective_to is null or m.match_date <= r.effective_to)
              and nullif(trim(r.source_document), '') is not null
            for share of m, r
        `);
        // 조회된 첫 경기 문맥 읽음
        const [match] = rows as unknown as Array<{
            match_id: string;
            match_date: string;
            competition: string;
            season: string;
            ifab_edition: string;
        }>;
        // 조건에 맞는 검증 경기가 없으면 현재 검증 경기 없음 반환
        if (!match) return undefined;
        // 사건이 선언하는 경기 문맥과 대조할 현재 검증 경기 반환
        return {
            matchId: match.match_id,
            competition: match.competition,
            season: match.season,
            matchDate: match.match_date,
            ifabVersionId: `ifab-${match.ifab_edition}`
        };
    };
    // 모든 행의 검증과 서버 평가를 첫 쓰기 전에 완료한 저장 계획
    const plan = await incidentPlan(batch, context, currentMatch);
    // 검증을 마친 계획 행을 순서대로 저장
    for (const row of plan) {
        // 비공개 관측 행 저장
        const inserted = await transaction.execute(sql`
            insert into analysis_incident_observations
                (analysis_id, job_id, job_revision, source_sha256, artifact_sha256, schema_version,
                 observation_id, candidate_id, content_sha256, observation, reasons, created_at, expires_at)
            values (${context.analysisId}, ${context.jobId}, ${context.jobRevision},
                ${Buffer.from(context.sourceSha256, "hex")}, ${Buffer.from(context.artifactSha256, "hex")},
                ${batch.schemaVersion}, ${row.observation.observationId}, ${row.observation.candidateId},
                ${Buffer.from(row.observationSha256, "hex")}, ${JSON.stringify(row.observation)}::jsonb,
                ${JSON.stringify(row.reasons)}::jsonb, ${context.now}, ${context.expiresAt}) returning id
        `);
        // 유형별 사건이 없는 관측은 관측 행만 저장
        if (!row.record) continue;
        // 방금 저장한 관측 행 식별자 읽음
        const [saved] = inserted as unknown as Array<{ id: string }>;
        // 관측 행 저장 결과가 없으면 전체 저장 취소
        if (!saved) throw new Error("INCIDENT_ROW_NOT_SAVED");
        // 서버가 다시 계산한 승인과 평가를 담은 유형별 사건 저장
        await transaction.execute(sql`
            insert into analysis_incident_records
                (observation_id, incident_id, content_sha256, record, lineage, admitted_fact_ids, evaluations)
            values (${saved.id}, ${row.record.value.incidentId}, ${Buffer.from(row.record.recordSha256, "hex")},
                ${JSON.stringify(row.record.value)}::jsonb, ${JSON.stringify(row.record.link)}::jsonb,
                ${JSON.stringify(row.record.factIds)}::jsonb, ${JSON.stringify(row.record.evaluations)}::jsonb)
        `);
    }
}

// 분석 소유 범위와 현재 작업 판본 및 원본 보존 기한을 확인한 내부 조회
export async function incidentQuery(
    database: Pick<DatabaseClient, "db">,
    input: { analysisId: string; anonymousSessionId: string; after: string | null; limit: number },
    now: string
) {
    // 소유 확인과 목록 조회가 함께 쓰는 분석과 원본과 세션의 공개 가능 조건
    const owned = sql`analysis.id = ${input.analysisId} and session.id = ${input.anonymousSessionId}
        and analysis.status = 'COMPLETED' and video.status = 'VALID'
        and ${liveAnalysis(now)} and ${liveVideo(now)} and ${activeSession(now)}`;
    // 소유 확인과 목록 조회를 같은 읽기 스냅숏에서 실행
    return database.db.transaction(async (transaction) => {
        const owner = await transaction.execute(sql`
            select analysis.id from analyses as analysis
            join video_assets as video on video.id = analysis.video_asset_id
            join anonymous_sessions as session on session.id = analysis.anonymous_session_id
            where ${owned}
            limit 1
        `);
        if (!(owner as unknown as unknown[]).length) return null;
        const rows = await transaction.execute(sql`
            select o.id, o.job_id, o.job_revision, o.observation, o.reasons,
                r.record, r.lineage, r.admitted_fact_ids, r.evaluations
            from analysis_incident_observations o
            join analyses as analysis on analysis.id = o.analysis_id
            join video_assets as video on video.id = analysis.video_asset_id
            join anonymous_sessions as session on session.id = analysis.anonymous_session_id
            join processing_jobs j on j.id = o.job_id
            left join analysis_incident_records r on r.observation_id = o.id
            where ${owned} and j.status = 'SUCCEEDED'
              and j.job_revision = o.job_revision and o.source_sha256 = analysis.source_fingerprint
              and o.source_sha256 = video.content_sha256 and o.expires_at > ${now}
              and (${input.after}::uuid is null or o.id > ${input.after}::uuid)
            order by o.id limit ${input.limit + 1}
        `);
        const items = rows as unknown as Array<Record<string, unknown> & { id: string }>;
        return { schemaVersion: "private-incidents-v1", rows: items.slice(0, input.limit),
            next: items.length > input.limit ? items[input.limit - 1]!.id : null };
    }, CONSISTENT_READ);
}
