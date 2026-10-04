// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 증거 접근 확인 명령과 결과 계약 가져옴
import type { EvidenceAccess, EvidenceAccessCommand } from "@replay/application";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결 계약 가져옴
import type { DatabaseHandle } from "./connection";

// 작업 임대에 따른 원본 접근 확인
export async function access(
    client: DatabaseHandle,
    command: EvidenceAccessCommand
): Promise<EvidenceAccess> {
    // 현재 작업 임대가 증거 업로드 권한을 가지는지 확인
    const rows = await client.db.execute(sql`
      select analysis_id, ${liveJob(command.now)} as live
      from processing_jobs as job
      where id = ${command.jobId}
        and job_type = 'ANALYZE_VIDEO'
        and analysis_id is not null
        and status = 'PROCESSING'
        and job_revision = ${command.jobRevision}
        and lease_owner = ${command.workerId}
        and lease_token_hash = ${Buffer.from(command.leaseTokenHash)}
        and lease_until > ${command.now}
      limit 1
    `);
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [row] = rows as unknown as Array<{ analysis_id: string; live: boolean }>;
    // 임대는 유효해도 원본이 보존 규칙을 벗어났으면 고아 증거 객체를 막도록 권한 거부
    if (row && !row.live) return { kind: "SOURCE_UNAVAILABLE" };
    // 유효한 작업 임대면 분석 식별자 반환
    if (row) return { kind: "AUTHORIZED", analysisId: row.analysis_id };
    // 작업 상태 확인
    const jobs = await client.db.execute(sql`
      select status from processing_jobs where id = ${command.jobId} limit 1
    `);
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [job] = jobs as unknown as Array<{ status: string }>;
    // 작업이 없으면 접근 실패
    if (!job) return { kind: "NOT_FOUND" };
    // 처리 중이면 작업 임대 만료 결과 반환
    return job.status === "PROCESSING" ? { kind: "STALE_LEASE" } : { kind: "ALREADY_FINISHED" };
}
