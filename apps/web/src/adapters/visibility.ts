// 저장소 질의 조각 생성 기능 가져옴
import { sql } from "drizzle-orm";

// 여러 질의가 같은 시점의 자료를 보도록 반복 읽기 수준의 읽기 전용 트랜잭션 설정
export const CONSISTENT_READ = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

// session 별칭으로 연결한 익명 세션의 폐기 여부와 기한 조건 생성
export const activeSession = (now: string) =>
    sql`session.revoked_at is null and session.expires_at > ${now}`;

// video 별칭으로 연결한 원본 영상의 객체 삭제 여부와 기한 조건 생성하며 기한 없는 원본은 영속 금지 제약에 따라 제외
export const liveVideo = (now: string) =>
    sql`video.object_deleted_at is null and video.expires_at > ${now}`;

// analysis 별칭으로 연결한 분석이 가리키는 원본 영상의 생존 조건 생성
export const liveSource = (now: string) =>
    sql`exists (
        select 1 from video_assets as video
        where video.id = analysis.video_asset_id and ${liveVideo(now)}
    )`;

// analysis 별칭으로 연결한 분석과 그 기원 자료 전체가 따르는 보존 기한 조건 생성
export const liveAnalysis = (now: string) => sql`analysis.expires_at > ${now}`;

// asset 별칭으로 연결한 증거 자산의 객체 삭제 여부와 기한 조건 생성
export const liveEvidence = (now: string) =>
    sql`asset.object_deleted_at is null and asset.expires_at > ${now}`;

// job 별칭으로 연결한 처리 작업의 대상과 소유 세션이 보존 규칙 안에 있는지 조건 생성하며 만료 대상을 지우는 정리 작업은 조건에서 제외
export const liveJob = (now: string) =>
    sql`(case job.job_type
        when 'VALIDATE_VIDEO' then exists (
            select 1 from video_assets as video
            join anonymous_sessions as session on session.id = video.anonymous_session_id
            where video.id = job.video_asset_id and ${liveVideo(now)} and ${activeSession(now)}
        )
        when 'ANALYZE_VIDEO' then exists (
            select 1 from analyses as analysis
            join anonymous_sessions as session on session.id = analysis.anonymous_session_id
            where analysis.id = job.analysis_id
                and ${liveAnalysis(now)} and ${liveSource(now)} and ${activeSession(now)}
        )
        else true
    end)`;
