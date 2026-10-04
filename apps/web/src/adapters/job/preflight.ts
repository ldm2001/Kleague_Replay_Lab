// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 결과 제출 전 사전 검사 명령과 결과 계약 가져옴
import type { JobResultPreflight, JobResultPreflightCommand } from "@replay/application";
// 원본 해시에 대응하는 등록 경기 정보 가져옴
import { knownVideoSource } from "@replay/shared-types";
// 자동 평가의 경기 문맥 연결 기능 가져옴
import { automaticContext } from "../automatic-context";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결과 시계 계약 가져옴
import type { DatabaseHandle, WallClock } from "./connection";

// 경기 연결이 없는 등록 원본을 잠금 안에서 검증된 경기와 규정 문맥에 연결하고 연결 여부 반환
async function link(
    client: DatabaseHandle,
    wallClock: WallClock,
    command: JobResultPreflightCommand,
    source: Buffer
): Promise<boolean> {
    // 잠금 안에서 등록 원본의 경기와 규정 문맥 연결 시도
    return client.db.transaction(async (transaction) => {
        // 임대와 원본 유효 기한 재검사에 사용할 실제 시각 읽음
        const now = wallClock().toISOString();
        // 현재 임대와 작업 대상 생존 조건을 충족한 분석 및 원본 잠금 조회
        const locked = await transaction.execute(sql`
            select analysis.id, video.content_sha256
            from processing_jobs as job join analyses as analysis on analysis.id = job.analysis_id
            join video_assets as video on video.id = analysis.video_asset_id
            where job.id = ${command.jobId} and job.job_type = 'ANALYZE_VIDEO' and job.status = 'PROCESSING'
              and job.job_revision = ${command.jobRevision} and job.lease_owner = ${command.workerId}
              and job.lease_token_hash = ${Buffer.from(command.leaseTokenHash)} and job.lease_until > ${now}
              and ${liveJob(now)}
              and analysis.match_id is null and analysis.applied_rule_version_id is null
              and analysis.source_fingerprint = video.content_sha256
              and video.content_sha256 = ${source}
            for update of job, analysis, video
          `);
        // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
        const [target] = locked as unknown as Array<{
            // 다른 기록과 구별하는 고유 식별자
            id: string;
            // 파일 내용의 동일성을 대조하는 해시
            content_sha256: Buffer;
        }>;
        // 잠금 시점에 접근 대상이 사라지면 연결 중단
        if (!target) return false;
        // 원본 해시와 등록 경기의 정확한 일치 문맥 조회
        const context = await automaticContext(
            target.content_sha256.toString("hex"),
            (statement) => transaction.execute(statement)
        );
        // 검증된 경기 문맥이 없으면 추정 연결 차단
        if (!context) return false;
        // 문맥 저장 직전의 실제 시각 읽음
        const saveNow = wallClock().toISOString();
        // 작업 임대와 작업 대상 생존 조건을 저장 시각에 다시 확인한 뒤 경기와 규정 연결 저장
        const saved = await transaction.execute(sql`
            update analyses
            set match_id = ${context.matchId}, applied_rule_version_id = ${context.ruleId},
                state_version = state_version + 1
            where id = ${target.id}
              and exists(
                select 1 from processing_jobs as job
                where job.id = ${command.jobId} and job.lease_until > ${saveNow} and ${liveJob(saveNow)}
              )
            returning id
          `);
        // 유효 기한 재검사 후 실제 연결한 행의 존재 여부 반환
        return saved.length === 1;
    });
}

// 결과 제출 전 임대·원본·경기 문맥 확인
export async function preflight(
    client: DatabaseHandle,
    wallClock: WallClock,
    command: JobResultPreflightCommand
): Promise<JobResultPreflight> {
    // 현재 임대에 허용된 원본과 분석 및 규정 문맥 조회
    const rows = await client.db.execute(sql`
      select job.analysis_id, video.content_sha256, analysis.source_fingerprint,
             analysis.expires_at, analysis.match_id, rule.id as rule_version_id,
             rule.verification_status, rule.ifab_edition, rule.competition, rule.season, video.duration_ms,
             fixture.match_date::text as match_date, ${liveJob(command.now)} as live
      from processing_jobs as job
      join analyses as analysis on analysis.id = job.analysis_id
      join video_assets as video on video.id = analysis.video_asset_id
      left join competition_rule_versions as rule on rule.id = analysis.applied_rule_version_id
      left join matches as fixture on fixture.id = analysis.match_id
      where job.id = ${command.jobId}
        and job.job_type = 'ANALYZE_VIDEO'
        and job.status = 'PROCESSING'
        and job.job_revision = ${command.jobRevision}
        and job.lease_owner = ${command.workerId}
        and job.lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
        and job.lease_until > ${command.now}
      limit 1
    `);
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [row] = rows as unknown as Array<{
        // 분석 기록의 식별자
        analysis_id: string;
        // 파일 내용의 동일성을 대조하는 해시
        content_sha256: Buffer | null;
        // 분석 대상 원본과의 일치 확인용 해시
        source_fingerprint: Buffer | null;
        // 접근과 보존을 허용하는 만료 시각
        expires_at: string | null;
        // 검증된 경기 기록의 식별자
        match_id: string | null;
        // 대회 규정 판본 식별자
        rule_version_id: string | null;
        // 규정 문맥의 검증 상태
        verification_status: string | null;
        // 국제 축구 규정의 판본
        ifab_edition: string | null;
        // 규정 적용 대상 대회
        competition: string | null;
        // 규정 적용 대상 시즌
        season: string | null;
        // 영상 전체 길이의 밀리초 값
        duration_ms: number | null;
        // 검증된 경기의 개최 날짜
        match_date?: string | null;
        // 작업 대상과 소유 세션이 보존 규칙 안에 있는지 여부
        live: boolean;
    }>;
    // 유효한 작업 임대와 원본 문맥 조회 성공 여부 확인
    if (row) {
        // 임대는 유효해도 작업 대상이 보존 규칙을 벗어났으면 무거운 파일 검사 전에 원본 거부 반환
        if (!row.live) return { kind: "INVALID_RESULT", reason: "SOURCE" };
        // 경기 연결이 없는 등록 원본에 대해서만 자동 문맥 연결 시도
        if (
            !row.match_id &&
            !row.rule_version_id &&
            row.content_sha256 &&
            knownVideoSource(row.content_sha256.toString("hex"))
        ) {
            // 잠금 안에서 등록 원본의 경기와 규정 문맥 연결 시도
            const linked = await link(client, wallClock, command, row.content_sha256);
            // 새로 연결된 문맥이 있으면 사전 검사 다시 실행
            if (linked) return preflight(client, wallClock, command);
        }
        // 현재 임대에 허용된 원본 해시와 경기 규정 문맥 반환
        return {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "AUTHORIZED",
            // 분석 기록의 식별자
            analysisId: row.analysis_id,
            // 분석한 원본 영상의 내용 해시
            sourceSha256: Uint8Array.from(row.content_sha256 ?? []),
            // 분석 기록이 보존한 원본 해시
            analysisSourceSha256: Uint8Array.from(row.source_fingerprint ?? []),
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
            // 영상 전체 길이의 밀리초 값
            durationMs: row.duration_ms,
            // 검증된 경기의 적용 규정 판본
            ruleEdition:
                row.match_id &&
                row.rule_version_id &&
                row.verification_status === "VERIFIED" &&
                row.ifab_edition
                    ? {
                          // 다른 기록과 구별하는 고유 식별자
                          id: row.rule_version_id,
                          // 규정 문맥의 검증 상태
                          verificationStatus: row.verification_status,
                          // 검증된 경기 기록의 식별자
                          matchId: row.match_id,
                          // 국제 축구 규정의 판본
                          ifabEdition: row.ifab_edition,
                          ...(row.competition ? { competition: row.competition } : {}),
                          ...(row.season ? { season: row.season } : {}),
                          ...(row.match_date ? { matchDate: row.match_date } : {})
                      }
                    : null
        };
    }
    // 현재 작업의 존재 여부와 처리 상태 조회
    const jobs = await client.db.execute(
        sql`select status from processing_jobs where id = ${command.jobId} limit 1`
    );
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [job] = jobs as unknown as Array<{ status: string }>;
    // 작업 자체가 없으면 부재 결과 반환
    if (!job) return { kind: "NOT_FOUND" };
    // 진행 중 임대 불일치와 이미 종료된 작업을 구분하여 반환
    return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
}
