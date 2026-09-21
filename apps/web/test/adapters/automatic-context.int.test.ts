import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { report } from "@replay/application";
import { observation, type PushFacts } from "@replay/shared-types";
import { automaticReview } from "../../src/application/use-cases/evaluation/automatic";
import { perceptionPayload } from "../fixtures/perception";
import { context as pushContext } from "../fixtures/push-context";
import { judgment } from "../fixtures/result";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("automatic source context", () => {
  if (!databaseUrl) return;
  const database = client(databaseUrl);
  afterAll(() => database.close());
  it("links exact known match and only a unique independently verified sourced edition", async () => {
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    const home = randomUUID(), away = randomUUID(), match = randomUUID(), duplicate = randomUUID();
    const [existingRule] = await database.sql`select id, verification_status, source_document from competition_rule_versions
      where competition = 'K리그2' and season = '2026' and effective_from = '2026-07-01'`;
    const rule = existingRule!.id;
    const source = Buffer.from("2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857", "hex"), lease = randomBytes(32);
    const now = "2030-01-01T00:00:00.000Z", expires = "2030-01-02T00:00:00.000Z";
    try {
      await database.sql`insert into clubs(id, canonical_name, short_code) values (${home}, '충북청주', ${home.slice(0, 8)}), (${away}, '수원', ${away.slice(0, 8)})`;
      await database.sql`insert into matches(id, competition, season, match_date, home_club_id, away_club_id, score_home, score_away)
        values (${match}, 'K리그2', '2026', '2026-08-01', ${home}, ${away}, 2, 2), (${duplicate}, 'K리그2', '2026', '2026-08-01', ${home}, ${away}, 2, 2)`;
      await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at) values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
      await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
      await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class, source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source}, 'video-local-observers-v1', 'media-v1', ${now}, ${expires})`;
      await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision, attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'worker', ${lease}, ${expires}, ${now}, ${now})`;
      const store = new JobStore(database, () => new Date(now));
      const command = { jobId, workerId: "worker", jobRevision: 1, leaseTokenHash: lease, now };
      expect(await store.preflight(command)).toMatchObject({ kind: "AUTHORIZED", ruleEdition: null });
      expect((await database.sql`select match_id from analyses where id = ${analysisId}`)[0]?.match_id).toBeNull();
      await database.sql`delete from matches where id = ${duplicate}`;
      expect(await store.preflight(command)).toMatchObject({ kind: "AUTHORIZED", ruleEdition: null });
      expect((await database.sql`select match_id, applied_rule_version_id from analyses where id = ${analysisId}`)[0]).toMatchObject({ match_id: match, applied_rule_version_id: null });
      // Independent new unpinned analysis state simulates a later upload; existing pins are never replaced.
      await database.sql`update analyses set match_id = null where id = ${analysisId}`;
      await database.sql`update competition_rule_versions set verification_status = 'VERIFIED', source_document = 'https://example.test/verified-adoption' where id = ${rule}`;
      expect(await store.preflight(command)).toMatchObject({ kind: "AUTHORIZED", ruleEdition: { id: rule, matchId: match, competition: "K리그2", season: "2026" } });

      // Explicitly synthetic TESTONLY producer. Production registry remains unsupported.
      const producer = { methodId: "TESTONLY-pushing-db", version: "1", validationReportSha256: "d".repeat(64) };
      const facts: PushFacts = { contactDetected: observation(true, "NORMAL", []), severity: observation("CARELESS", "NORMAL", []),
        opponentDisplacement: observation("none", "NORMAL", []), insidePenaltyArea: observation(false, "NORMAL", []), cameraSufficiency: "HIGH", context: pushContext() };
      const original = perceptionPayload();
      const evidence = { ...original.evidence![0]!, kind: "CLIP" as const, startMs: 500, endMs: 1500,
        objectKey: `evidence/${analysisId}/${jobId}/1/${original.evidence![0]!.contentSha256}/clip.mp4` };
      const payload = { ...original, evidence: [evidence], perception: { ...original.perception!, sourceSha256: source.toString("hex"),
        artifact: { ...original.perception!.artifact, objectKey: `perception/${analysisId}/${jobId}/1/${original.perception!.artifact.contentSha256}.jsonl.gz` } } };
      const automatic = automaticReview({ analysisId, jobId, jobRevision: 1, sourceSha256: source.toString("hex"),
        durationMs: 2000, pipelineVersion: payload.pipelineVersion, perception: payload.perception, candidates: payload.candidates,
        references: [{ ...evidence, evidenceIndex: 0, immutable: true }],
        rule: { id: rule, matchId: match, competition: "K리그2", season: "2026", ifabVersionId: "ifab-2026-27", verificationStatus: "VERIFIED" } },
      { registry: [producer], produce: () => ({ kind: "READY", producer, facts, evidenceIndices: [0] }) });
      expect(automatic.rows[0]?.result?.decision).toBe("FOUL");
      expect(await store.result({ ...command, payload, automaticReview: automatic,
        perceptionVerification: { analysisId, sourceSha256: source, admission: { status: "NOT_ADMITTED", reasons: ["TESTONLY"] } } })).toEqual({ kind: "ACCEPTED" });
      const reader = new StatusStore(database);
      const read = report({ repository: reader, clock: { now: () => new Date(now) } });
      const published = await read({ analysisId, anonymousSessionId: sessionId });
      expect(JSON.stringify(published)).not.toContain("factSignatureInput");
      expect(JSON.stringify(published)).not.toContain("automaticReviewSummary");
      expect(published).toMatchObject({ evaluatedCount: 1, completedScopeCount: 0, judgmentStatus: "PARTIAL",
        candidates: [{ automaticJudgment: { result: { decision: "FOUL" }, producer }, judgment: null }] });
      const candidate = (await database.sql`select id from incident_candidates where analysis_id = ${analysisId}`)[0]!.id;
      const revision = randomUUID();
      await database.sql`insert into fact_revisions(id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source)
        values (${revision}, ${analysisId}, ${candidate}, 1, ${JSON.stringify(judgment.facts)}::jsonb, 1, 'USER')`;
      await database.sql`update incident_candidates set current_fact_revision_id = ${revision} where id = ${candidate}`;
      await database.sql`insert into decision_results(analysis_id, incident_candidate_id, fact_revision_id, applied_rule_version_id,
        observed_restart_type, observed_restart_beneficiary, observed_goal_decision, observed_source,
        foul_decision, restart_type, disciplinary_action, decision_match, var_reviewable, var_category, var_within_time_window,
        var_threshold_met, var_intervention, var_window_exception, var_review_procedure, judgment_confidence_level,
        fact_signature, rule_engine_version, evaluation_schema_version, evaluation_snapshot, citations)
        values (${analysisId}, ${candidate}, ${revision}, ${rule}, 'PLAY_CONTINUED', 'NONE', 'NOT_APPLICABLE', 'USER_INPUT',
        'NO_FOUL', 'PLAY_CONTINUED', 'NONE', 'UNDETERMINED', false, 'NONE', false, 'UNDETERMINED', 'NO_INTERVENTION', 'NONE', 'NONE', 'HIGH',
        ${randomBytes(32)}, 'legacy-test', 1, '{}'::jsonb, ${JSON.stringify(judgment.citations)}::jsonb)`;
      expect((await reader.analysis({ analysisId, anonymousSessionId: sessionId, now }))?.candidates[0]?.judgment?.decision).toBe("NO_FOUL");
      expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({ evaluatedCount: 1,
        candidates: [{ automaticJudgment: { result: { decision: "FOUL" } }, judgment: null }] });
      await database.sql`update evidence_assets set object_deleted_at = ${now} where analysis_id = ${analysisId}`;
      expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({ evaluatedCount: 0, candidates: [] });
      await database.sql`update evidence_assets set object_deleted_at = null where analysis_id = ${analysisId}`;
      await database.sql`update competition_rule_versions set verification_status = 'UNVERIFIED' where id = ${rule}`;
      expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({ evaluatedCount: 0, candidates: [] });
      await database.sql`update competition_rule_versions set verification_status = 'VERIFIED' where id = ${rule}`;
      await database.sql`update analyses set source_fingerprint = ${randomBytes(32)} where id = ${analysisId}`;
      expect(await read({ analysisId, anonymousSessionId: sessionId })).toMatchObject({ evaluatedCount: 0, candidates: [] });
    } finally {
      await database.sql`delete from analysis_perception_runs where analysis_id = ${analysisId}`;
      await database.sql`delete from processing_job_events where job_id = ${jobId}`;
      await database.sql`delete from processing_jobs where id = ${jobId}`;
      await database.sql`delete from analyses where id = ${analysisId}`;
      await database.sql`delete from video_assets where id = ${videoId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
      await database.sql`update competition_rule_versions set verification_status = ${existingRule!.verification_status}, source_document = ${existingRule!.source_document} where id = ${rule}`;
      await database.sql`delete from matches where id in (${match}, ${duplicate})`;
      await database.sql`delete from clubs where id in (${home}, ${away})`;
    }
  });
});
