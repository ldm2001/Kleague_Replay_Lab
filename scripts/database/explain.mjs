// 데이터베이스 연결 도구 가져오기
import postgres from "postgres";

// 데이터베이스 연결 주소 참조
const databaseUrl = process.env.DATABASE_URL;

// 데이터베이스 연결 주소가 빠졌는지 확인
if (!databaseUrl) {
    // 입력 또는 실행 조건을 만족하지 못해 오류 전달
    throw new Error("DATABASE_URL is required");
}

// 실행할 데이터베이스 질의 확인
const sql = postgres(databaseUrl, { max: 1 });
// 실제 질의 수행까지 측정할지 여부 계산
const analyze = process.env.EXPLAIN_ANALYZE === "1";
// 선택한 실행 계획 조회 방식 계산
const explain = analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)" : "EXPLAIN (FORMAT JSON)";

// 데이터베이스 실행 계획 목록 구성
const plans = [
    {
        // 항목 이름 기록
        name: "job-claim",
        // 조회할 질의 내용 기록
        query: `
      select id
      from processing_jobs
      where job_type = 'ANALYZE_VIDEO'
        and status = 'QUEUED'
        and (next_attempt_at is null or next_attempt_at <= current_timestamp)
        and attempt < max_attempts
      order by next_attempt_at nulls first, created_at, id
      limit 1
    `,
    },
    {
        // 항목 이름 기록
        name: "session-lookup",
        // 조회할 질의 내용 기록
        query: `
      select id
      from anonymous_sessions
      where token_hash = decode('00', 'hex')
        and revoked_at is null
        and expires_at > current_timestamp
      limit 1
    `,
    },
    {
        // 항목 이름 기록
        name: "upload-lookup",
        // 조회할 질의 내용 기록
        query: `
      select id, object_key, expected_size_bytes, declared_content_type, expires_at
      from upload_intents
      where anonymous_session_id = '00000000-0000-4000-8000-000000000000'
        and status in ('CREATED', 'UPLOADING')
      order by expires_at
      limit 1
    `,
    },
    {
        // 항목 이름 기록
        name: "analysis-lookup",
        // 조회할 질의 내용 기록
        query: `
      select id, status, created_at, expires_at
      from analyses
      where anonymous_session_id = '00000000-0000-4000-8000-000000000000'
        and retention_class = 'TEMPORARY'
      order by created_at desc
      limit 20
    `,
    },
];

// 조회 성공 여부와 관계없이 연결을 닫을 실행 구간
try {
    // 데이터베이스 실행 계획 목록의 각 항목을 순서대로 검사
    for (const item of plans) {
        // 조회 또는 평가한 항목 목록 읽음
        const rows = await sql.unsafe(`${explain} ${item.query}`);
        // 처리 결과 출력
        console.log(JSON.stringify({ name: item.name, plan: rows[0]?.["QUERY PLAN"] }, null, 2));
    }
} finally {
    // 확인 작업을 마친 데이터베이스 연결 종료
    await sql.end({ timeout: 5 });
}
