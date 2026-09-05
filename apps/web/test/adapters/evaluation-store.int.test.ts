// 평가 저장소 통합 테스트
import { createHash as digest, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evaluationStore } from "@replay/adapters";
import { assessment } from "@replay/application";
import { pushResult, varResult } from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";
import { client } from "@replay/database";
import { observation, type EvaluationFacts } from "@replay/shared-types";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const NOW = "2026-09-03T02:00:00.000Z";
const EXPIRES = "2026-09-04T02:00:00.000Z";

describeDatabase("PostgreSQL evaluation repository", () => {
  const database = databaseUrl ? client(databaseUrl) : null;
  if (!database) return;
  const repository = evaluationStore(database);
  const sessions: string[] = [];

  beforeAll(async () => {
    await database.sql`select 1`;
  });

  afterEach(async () => {
    for (const sessionId of sessions.splice(0)) {
      await database.sql`delete from analyses where anonymous_session_id = ${sessionId}`;
      await database.sql`delete from video_assets where anonymous_session_id = ${sessionId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });

  afterAll(async () => {
    await database.close();
  });

  it("stores facts with shot links and a cited IFAB and K League decision", async () => {
    const sessionId = randomUUID();
    const videoId = randomUUID();
    const analysisId = randomUUID();
    const candidateId = randomUUID();
    const shotId = randomUUID();
    sessions.push(sessionId);
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2026-09-02T00:00:00.000Z', ${EXPIRES})
    `;
    await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([1])}, 'video/mp4', 100, 'VALID', 'K리그2', '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
    const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = 'K리그2' and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
    await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${NOW}, ${EXPIRES})
    `;
    await database.sql`
      insert into shots (id, analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay, camera_angle_label)
      values (${shotId}, ${analysisId}, 0, 0, 2000, 'NORMAL', false, 'MAIN')
    `;
    await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, anchor_ms, detection_confidence, camera_sufficiency, reasons, shot_indices, review_status)
      values (${candidateId}, ${analysisId}, 1, 'PENALTY_NOT_GIVEN', 0, 1800, 900, .8, 'HIGH', '[]'::jsonb, '[0]'::jsonb, 'UNREVIEWED')
    `;

    const facts: EvaluationFacts = {
      push: {
        contactDetected: observation(true, "NORMAL", [shotId]),
        severity: observation("RECKLESS", "NORMAL", [shotId]),
        opponentDisplacement: observation("clear", "NORMAL", [shotId]),
        insidePenaltyArea: observation(true, "NORMAL", [shotId]),
        cameraSufficiency: "HIGH",
      },
      variable: {
        reviewScenario: "PENALTY_NOT_GIVEN",
        restartOccurred: false,
        sendOffCategory: "NONE",
        mistakenIdentity: false,
        decisionNature: "SUBJECTIVE",
        errorMagnitude: "CLEAR_AND_OBVIOUS",
        seriousMissedIncident: false,
      },
      observed: { restartType: "PLAY_CONTINUED", restartBeneficiary: "NONE", card: null, goalDecision: "NOT_APPLICABLE", source: "USER_INPUT" },
    };
    const keyHash = digest("sha256").update("fact-1").digest();
    const requestHash = digest("sha256").update(JSON.stringify(facts)).digest();
    const saved = await repository.patch({ anonymousSessionId: sessionId, analysisId, candidateId, expectedFactRevisionId: null, facts, keyHash, requestHash, now: NOW });
    expect(saved.kind).toBe("CREATED");
    if (saved.kind !== "CREATED") return;
    await expect(repository.patch({ anonymousSessionId: sessionId, analysisId, candidateId, expectedFactRevisionId: null, facts, keyHash, requestHash, now: NOW })).resolves.toMatchObject({ kind: "REPLAYED", factRevisionId: saved.factRevisionId });

    const context = await repository.context({ anonymousSessionId: sessionId, analysisId, candidateId, now: NOW });
    expect(context.kind).toBe("READY");
    if (context.kind !== "READY") return;
    const run = assessment({ rule: ruleSet, push: pushResult, variable: varResult, hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest()) });
    const judged = await run({ ruleVersionId: context.value.ruleVersionId, push: facts.push, variable: facts.variable, options: context.value.competitionOptions });
    expect(judged.kind).toBe("EVALUATED");
    if (judged.kind !== "EVALUATED") return;
    const decision = await repository.save({ anonymousSessionId: sessionId, analysisId, candidateId, factRevisionId: saved.factRevisionId, ruleVersionId: context.value.ruleVersionDbId, analysisStateVersion: context.value.analysisStateVersion, facts, evaluation: judged.value, ruleEngineVersion: "rule-engine-v1", evaluationSchemaVersion: 1, now: NOW });
    expect(decision.kind).toBe("CREATED");
    const [links] = await database.sql<{ count: string }[]>`select count(*)::text as count from fact_revision_shots where fact_revision_id = ${saved.factRevisionId}`;
    const [citation] = await database.sql<{ authorities: string[] }[]>`select array_agg(item->>'authority') as authorities from decision_results, jsonb_array_elements(citations) item where incident_candidate_id = ${candidateId}`;
    expect(links?.count).toBe("1");
    expect(citation?.authorities).toContain("KLEAGUE");
  });

  it("keeps a newer failed analysis state when a stale evaluation finishes", async () => {
    const sessionId = randomUUID();
    const videoId = randomUUID();
    const analysisId = randomUUID();
    const candidateId = randomUUID();
    const factId = randomUUID();
    sessions.push(sessionId);
    const facts: EvaluationFacts = {
      push: {
        contactDetected: observation(true, "NORMAL", []),
        severity: observation("CARELESS", "NORMAL", []),
        opponentDisplacement: observation("possible", "NORMAL", []),
        insidePenaltyArea: observation(false, "NORMAL", []),
        cameraSufficiency: "HIGH",
      },
      variable: {
        reviewScenario: "GOAL_DISALLOWED",
        restartOccurred: false,
        sendOffCategory: "NONE",
        mistakenIdentity: false,
        decisionNature: "SUBJECTIVE",
        errorMagnitude: "UNDETERMINED",
        seriousMissedIncident: false,
      },
      observed: { restartType: "DIRECT_FREE_KICK", restartBeneficiary: "DEFENDING_TEAM", card: null, goalDecision: "NO_GOAL", source: "USER_INPUT" },
    };
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2026-09-02T00:00:00.000Z', ${EXPIRES})
    `;
    await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([2])}, 'video/mp4', 100, 'VALID', 'K리그1', '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
    const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = 'K리그1' and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
    await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, state_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, 0, ${NOW}, ${EXPIRES})
    `;
    await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, detection_confidence, camera_sufficiency, reasons, shot_indices, review_status)
      values (${candidateId}, ${analysisId}, 1, 'GOAL_DISALLOWED', 0, 1800, .8, 'HIGH', '[]'::jsonb, '[]'::jsonb, 'CONFIRMED')
    `;
    await database.sql`
      insert into fact_revisions (id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source, created_at)
      values (${factId}, ${analysisId}, ${candidateId}, 1, ${JSON.stringify(facts)}::jsonb, 1, 'USER', ${NOW})
    `;
    await database.sql`update incident_candidates set current_fact_revision_id = ${factId} where id = ${candidateId}`;
    const context = await repository.context({ anonymousSessionId: sessionId, analysisId, candidateId, now: NOW });
    expect(context.kind).toBe("READY");
    if (context.kind !== "READY") return;
    expect(context.value.analysisStateVersion).toBe(0);
    await database.sql`update analyses set status = 'FAILED', state_version = 1 where id = ${analysisId}`;
    const run = assessment({ rule: ruleSet, push: pushResult, variable: varResult, hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest()) });
    const judged = await run({ ruleVersionId: context.value.ruleVersionId, push: facts.push, variable: facts.variable, options: context.value.competitionOptions });
    expect(judged.kind).toBe("EVALUATED");
    if (judged.kind !== "EVALUATED") return;

    await expect(repository.save({ anonymousSessionId: sessionId, analysisId, candidateId, factRevisionId: factId, ruleVersionId: context.value.ruleVersionDbId, analysisStateVersion: context.value.analysisStateVersion, facts, evaluation: judged.value, ruleEngineVersion: "rule-engine-v1", evaluationSchemaVersion: 1, now: NOW })).resolves.toMatchObject({ kind: "STALE_ANALYSIS" });

    const [analysis] = await database.sql<{ status: string; state_version: number }[]>`select status, state_version from analyses where id = ${analysisId}`;
    expect(analysis).toEqual({ status: "FAILED", state_version: 1 });
  });
});
