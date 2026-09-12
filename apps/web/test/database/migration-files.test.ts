// 마이그레이션 파일 테스트
import { describe, expect, it } from "vitest";
import { migrations } from "../../../../scripts/database/migrations.mjs";

describe("migration discovery", () => {
  it("loads every SQL migration in filename order with a checksum", async () => {
    const list = await migrations();

    expect(list.map((migration) => migration.name)).toEqual([
      "0000_initial_schema",
      "0001_ttl_expiry_policy",
      "0002_append_only_records",
      "0003_upload_intents",
      "0004_upload_intent_policy",
      "0005_analysis_status",
      "0006_job_progress",
      "0007_analysis_output",
      "0008_candidate_output",
      "0009_candidate_ready",
      "0010_baseline_state",
      "0011_competition_context",
      "0012_kleague_rule_scope",
      "0013_observations",
      "0014_candidate_tracking",
      "0015_candidate_scene_event",
      "0016_broadcast_cue",
      "0017_analysis_perception_runs",
    ]);
    expect(list[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(list[0]?.sql).toContain("CREATE TABLE analyses");
    const status = list.find((migration) => migration.name === "0005_analysis_status");
    expect(status?.sql).toContain("analyses_status_check");
    expect(status?.sql).toContain("APPLYING_RULES");
    const output = list.find((migration) => migration.name === "0007_analysis_output");
    expect(output?.sql).toContain("limitations");
    const candidate = list.find((migration) => migration.name === "0008_candidate_output");
    expect(candidate?.sql).toContain("anchor_ms");
    const context = list.find((migration) => migration.name === "0011_competition_context");
    expect(context?.sql).toContain("competition_rule_versions");
    expect(context?.sql).toContain("K리그1");
    const scope = list.find((migration) => migration.name === "0012_kleague_rule_scope");
    expect(scope?.sql).toContain("KLEAGUE");
    const broadcast = list.find((migration) => migration.name === "0016_broadcast_cue");
    expect(broadcast?.sql).toContain("broadcast_cue jsonb");
    const perception = list.find((migration) => migration.name === "0017_analysis_perception_runs");
    expect(perception?.sql).toContain("CREATE TABLE analysis_perception_runs");
    expect(perception?.sql).toContain("ON DELETE CASCADE");
    expect(perception?.sql).toContain("UNIQUE (job_id, job_revision)");
    expect(perception?.sql).toContain("octet_length(source_sha256) = 32");
    expect(perception?.sql).toContain("artifact_size_bytes > 0");
    expect(perception?.sql).toContain("artifact_size_bytes <= 134217728");
    expect(perception?.sql).toContain("jsonb_typeof(summary) = 'object'");
    expect(perception?.sql).toContain("octet_length(summary::text) <= 1048576");
    expect(perception?.sql).toContain("job_revision > 0");
    expect(perception?.sql).toContain("artifact_object_key =");
    expect(perception?.sql).toContain("jsonb_typeof(summary->'incidents') = 'array'");
    expect(perception?.sql).toContain("jsonb_typeof(summary->'admission') = 'object'");
  });
});
