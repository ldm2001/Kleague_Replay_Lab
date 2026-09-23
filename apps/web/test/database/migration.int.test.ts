import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;

// 데이터베이스 결과 처리 수행
describeDatabase("initial PostgreSQL migration", () => {
    // 질의 시험용 시험자료 결과 준비
    const sql = postgres(databaseUrl!, { max: 1 });

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await sql`select 1`;
    });

    afterAll(async () => {
        // 질의 종료 결과 처리 수행
        await sql.end({ timeout: 5 });
    });

    it("creates all MVP tables and the fact-shot relationship", async () => {
        // 데이터베이스 테이블 목록 조회
        const rows = await sql<{ tablename: string }[]>`
      select tablename
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `;

        // 시험자료 시험용 행목록 항목변환 결과 준비
        const tableNames = rows.map((row) => row.tablename);
        // 행목록 항목변환 반환값의 사실 개정번호 샷목록 포함 확인
        expect(tableNames).toContain("fact_revision_shots");
        // 행목록 항목변환 반환값의 작업목록 포함 확인
        expect(tableNames).toContain("processing_jobs");
        // 행목록 항목변환 반환값의 작업 포함 확인
        expect(tableNames).toContain("processing_job_events");
        // 행목록 항목변환 반환값의 판정 포함 확인
        expect(tableNames).toContain("decision_results");
        // 행목록 항목변환 반환값의 업로드 포함 확인
        expect(tableNames).toContain("upload_intents");
        // 행목록 항목변환 반환값의 분석 인식 포함 확인
        expect(tableNames).toContain("analysis_perception_runs");

        // 데이터베이스 구조 정보 조회
        const [policyColumn] = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_intents'
        and column_name = 'media_policy_version'
    `;
        // 정책 이름의 기대값 정책 버전 일치 확인
        expect(policyColumn?.column_name).toBe("media_policy_version");

        // 데이터베이스 구조 정보 조회
        const contextColumns = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'video_assets'
        and column_name in ('competition', 'season')
      order by column_name
    `;
        // 맥락 항목변환 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(contextColumns.map((column) => column.column_name)).toEqual([
            "competition",
            "season"
        ]);

        // 데이터베이스 구조 정보 조회
        const [sceneEventColumn] = await sql<
            { column_name: string; data_type: string; is_nullable: string }[]
        >`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'incident_candidates' and column_name = 'scene_event'
    `;
        // 장면 사건의 이름 장면 사건 및 자료 유형 지정 문자열 및 지정 항목 지정 문자열 자료 기준 구조 일치 확인
        expect(sceneEventColumn).toEqual({
            column_name: "scene_event",
            data_type: "jsonb",
            is_nullable: "YES"
        });

        // 데이터베이스 구조 정보 조회
        const [broadcastCueColumn] = await sql<
            { column_name: string; data_type: string; is_nullable: string }[]
        >`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'incident_candidates' and column_name = 'broadcast_cue'
    `;
        // 방송 단서의 이름 방송 단서 및 자료 유형 지정 문자열 및 지정 항목 지정 문자열 자료 기준 구조 일치 확인
        expect(broadcastCueColumn).toEqual({
            column_name: "broadcast_cue",
            data_type: "jsonb",
            is_nullable: "YES"
        });

        // 규정 조항 조회
        const [rule] = await sql<{ authority: string; law: string; source_document: string }[]>`
      select authority, law, source_url as source_document
      from rules
      where authority = 'KLEAGUE' and edition = '2026'
      limit 1
    `;
        // 규정의 권한 지정 문자열 및 조항 25 및 원본 대회 자료의 필드 일치 확인
        expect(rule).toMatchObject({
            authority: "KLEAGUE",
            law: "25",
            source_document: "https://www.kleague.com/about/competition.do"
        });
    });

    it("installs the relational constraints required by the DBML", async () => {
        // 데이터베이스 제약조건 조회
        const constraints = await sql<{ conname: string }[]>`
      select conname
      from pg_constraint
      where conname in (
        'fact_revision_shots_fact_fk',
        'fact_revision_shots_shot_fk',
        'incident_candidates_current_fact_revision_fk',
        'processing_jobs_target_check',
        'processing_jobs_progress_check',
        'processing_job_events_progress_check',
        'decision_results_citations_check',
        'competition_rule_versions_no_overlap',
        'analyses_temporary_expiry_policy_check',
        'analyses_status_check',
        'video_assets_expiry_after_creation_check',
        'idempotency_records_expiry_after_creation_check',
        'analysis_perception_runs_source_sha256_check',
        'analysis_perception_runs_artifact_sha256_check',
        'analysis_perception_runs_artifact_size_check',
        'analysis_perception_runs_model_provenance_check',
        'analysis_perception_runs_summary_check',
        'analysis_perception_runs_expiry_check',
        'analysis_perception_runs_job_revision_check',
        'analysis_perception_runs_artifact_key_check',
        'analysis_perception_runs_version_pair_check'
      )
      order by conname
    `;

        // 시험자료 항목변환 결과의 21개 항목 목록 기준 구조 일치 확인
        expect(constraints.map((constraint) => constraint.conname)).toEqual([
            "analyses_status_check",
            "analyses_temporary_expiry_policy_check",
            "analysis_perception_runs_artifact_key_check",
            "analysis_perception_runs_artifact_sha256_check",
            "analysis_perception_runs_artifact_size_check",
            "analysis_perception_runs_expiry_check",
            "analysis_perception_runs_job_revision_check",
            "analysis_perception_runs_model_provenance_check",
            "analysis_perception_runs_source_sha256_check",
            "analysis_perception_runs_summary_check",
            "analysis_perception_runs_version_pair_check",
            "competition_rule_versions_no_overlap",
            "decision_results_citations_check",
            "fact_revision_shots_fact_fk",
            "fact_revision_shots_shot_fk",
            "idempotency_records_expiry_after_creation_check",
            "incident_candidates_current_fact_revision_fk",
            "processing_job_events_progress_check",
            "processing_jobs_progress_check",
            "processing_jobs_target_check",
            "video_assets_expiry_after_creation_check"
        ]);
    });

    it("blocks updates to append-only fact and decision records", async () => {
        // 데이터베이스 트리거 조회
        const triggers = await sql<{ tgname: string }[]>`
      select tgname
      from pg_trigger
      where not tgisinternal
        and tgname in ('fact_revisions_no_update', 'decision_results_no_update', 'processing_job_events_no_update')
      order by tgname
    `;

        // 시험자료 항목변환 결과의 3개 항목 목록 기준 구조 일치 확인
        expect(triggers.map((trigger) => trigger.tgname)).toEqual([
            "decision_results_no_update",
            "fact_revisions_no_update",
            "processing_job_events_no_update"
        ]);
    });
});
