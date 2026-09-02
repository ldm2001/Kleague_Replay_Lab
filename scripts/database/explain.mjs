import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });
const analyze = process.env.EXPLAIN_ANALYZE === "1";
const explain = analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)" : "EXPLAIN (FORMAT JSON)";

const plans = [
  {
    name: "job-claim",
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
    name: "session-lookup",
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
    name: "upload-lookup",
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
    name: "analysis-lookup",
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

try {
  for (const item of plans) {
    const rows = await sql.unsafe(`${explain} ${item.query}`);
    console.log(JSON.stringify({ name: item.name, plan: rows[0]?.["QUERY PLAN"] }, null, 2));
  }
} finally {
  await sql.end({ timeout: 5 });
}
