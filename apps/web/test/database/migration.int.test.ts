import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("initial PostgreSQL migration", () => {
  const sql = postgres(databaseUrl!, { max: 1 });

  beforeAll(async () => {
    await sql`select 1`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("creates all MVP tables and the fact-shot relationship", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename
      from pg_tables
      where schemaname = 'public'
      order by tablename
    `;

    const tableNames = rows.map((row) => row.tablename);
    expect(tableNames).toContain("fact_revision_shots");
    expect(tableNames).toContain("processing_jobs");
    expect(tableNames).toContain("processing_job_events");
    expect(tableNames).toContain("decision_results");
    expect(tableNames).toContain("upload_intents");

    const [policyColumn] = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'upload_intents'
        and column_name = 'media_policy_version'
    `;
    expect(policyColumn?.column_name).toBe("media_policy_version");
  });

  it("installs the relational constraints required by the DBML", async () => {
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
        'idempotency_records_expiry_after_creation_check'
      )
      order by conname
    `;

    expect(constraints.map((constraint) => constraint.conname)).toEqual([
      "analyses_status_check",
      "analyses_temporary_expiry_policy_check",
      "competition_rule_versions_no_overlap",
      "decision_results_citations_check",
      "fact_revision_shots_fact_fk",
      "fact_revision_shots_shot_fk",
      "idempotency_records_expiry_after_creation_check",
      "incident_candidates_current_fact_revision_fk",
      "processing_job_events_progress_check",
      "processing_jobs_progress_check",
      "processing_jobs_target_check",
      "video_assets_expiry_after_creation_check",
    ]);
  });

  it("blocks updates to append-only fact and decision records", async () => {
    const triggers = await sql<{ tgname: string }[]>`
      select tgname
      from pg_trigger
      where not tgisinternal
        and tgname in ('fact_revisions_no_update', 'decision_results_no_update', 'processing_job_events_no_update')
      order by tgname
    `;

    expect(triggers.map((trigger) => trigger.tgname)).toEqual([
      "decision_results_no_update",
      "fact_revisions_no_update",
      "processing_job_events_no_update",
    ]);
  });
});
