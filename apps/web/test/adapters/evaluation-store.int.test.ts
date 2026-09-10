// 평가 저장소 통합 테스트
import { createHash as digest, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evaluationStore, statusStore } from "@replay/adapters";
import { assessment, decision as evaluateDecision } from "@replay/application";
import { pushResult, varResult } from "@replay/rule-engine";
import { combineCompetitionRules, ruleSet } from "@replay/rule-data";
import { client } from "@replay/database";
import { observation, type EvaluationFacts, type EvaluationResult, type RuleCitation } from "@replay/shared-types";

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

  it.each([
    ["K리그1", "kleague1-2026"],
    ["K리그2", "kleague2-2026"],
  ])("stores facts with shot links and a cited IFAB and %s decision", async (competition, versionId) => {
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
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([1])}, 'video/mp4', 100, 'VALID', ${competition}, '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
    const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = ${competition} and season = '2026' and ifab_edition = '2026-27'
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
    expect(context.value.competition).toEqual({ competition, season: "2026" });
    expect(context.value.competitionOptions).toEqual({});
    const run = assessment({ rule: ruleSet, competitionRule: combineCompetitionRules, push: pushResult, variable: varResult, hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest()) });
    const judged = await run({ ruleVersionId: context.value.ruleVersionId, ...(context.value.competition ? { competition: context.value.competition } : {}), push: facts.push, variable: facts.variable, observed: facts.observed, options: context.value.competitionOptions });
    expect(judged.kind).toBe("EVALUATED");
    if (judged.kind !== "EVALUATED") return;
    const leagueCitations = judged.value.citations.filter((item) => item.authority === "KLEAGUE");
    expect(leagueCitations.length).toBeGreaterThan(0);
    expect(leagueCitations.every((item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === "2026")).toBe(true);
    const decision = await repository.save({ anonymousSessionId: sessionId, analysisId, candidateId, factRevisionId: saved.factRevisionId, ruleVersionId: context.value.ruleVersionDbId, analysisStateVersion: context.value.analysisStateVersion, facts, evaluation: judged.value, ruleEngineVersion: "rule-engine-v1", evaluationSchemaVersion: 1, now: NOW });
    expect(decision.kind).toBe("CREATED");
    const [links] = await database.sql<{ count: string }[]>`select count(*)::text as count from fact_revision_shots where fact_revision_id = ${saved.factRevisionId}`;
    const [citation] = await database.sql<{ authorities: string[] }[]>`select array_agg(item->>'authority') as authorities from decision_results, jsonb_array_elements(citations) item where incident_candidate_id = ${candidateId}`;
    expect(links?.count).toBe("1");
    expect(citation?.authorities).toContain("KLEAGUE");
    expect(citation?.authorities).toContain("IFAB");
    const [snapshot] = await database.sql<{ citations: RuleCitation[]; evaluation_snapshot: EvaluationResult }[]>`
      select citations, evaluation_snapshot from decision_results where incident_candidate_id = ${candidateId}
    `;
    expect(snapshot?.citations).toEqual(judged.value.citations);
    expect(snapshot?.evaluation_snapshot).toEqual(judged.value);
  });

  it.each([
    ["K리그1", "kleague1-2026"],
    ["K리그2", "kleague2-2026"],
  ])("re-evaluates a legacy v1 %s decision without rewriting its history", async (competition, versionId) => {
    const sessionId = randomUUID();
    const videoId = randomUUID();
    const analysisId = randomUUID();
    const candidateId = randomUUID();
    const factId = randomUUID();
    sessions.push(sessionId);
    const facts: EvaluationFacts = {
      push: {
        contactDetected: observation(false, "NORMAL", []),
        severity: observation("CARELESS", "NORMAL", []),
        opponentDisplacement: observation("possible", "NORMAL", []),
        insidePenaltyArea: observation(false, "NORMAL", []),
        cameraSufficiency: "HIGH",
      },
      variable: {
        reviewScenario: "CORNER_KICK_AWARDED", restartOccurred: false,
        sendOffCategory: "NONE", mistakenIdentity: false, decisionNature: "SUBJECTIVE",
        errorMagnitude: "CLEAR_AND_OBVIOUS", seriousMissedIncident: false,
      },
      observed: { restartType: "CORNER_KICK", restartBeneficiary: "ATTACKING_TEAM", card: "NONE", goalDecision: "NOT_APPLICABLE", source: "USER_INPUT" },
    };
    await database.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, ${NOW}, ${EXPIRES})
    `;
    await database.sql`
      insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, competition, season, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from([3])}, 'video/mp4', 100, 'VALID', ${competition}, '2026', ${NOW}, ${NOW}, ${EXPIRES})
    `;
    const [version] = await database.sql<{ id: string }[]>`
      select id from competition_rule_versions
      where competition = ${competition} and season = '2026' and ifab_edition = '2026-27'
      limit 1
    `;
    await database.sql`
      insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${NOW}, ${EXPIRES})
    `;
    await database.sql`
      insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, camera_sufficiency, review_status)
      values (${candidateId}, ${analysisId}, 1, 'CORNER_KICK_AWARDED', 0, 1800, 'HIGH', 'CONFIRMED')
    `;
    await database.sql`
      insert into fact_revisions (id, analysis_id, incident_candidate_id, revision, facts, fact_schema_version, source, created_at)
      values (${factId}, ${analysisId}, ${candidateId}, 1, ${JSON.stringify(facts)}::jsonb, 1, 'USER', ${NOW})
    `;
    await database.sql`update incident_candidates set current_fact_revision_id = ${factId} where id = ${candidateId}`;
    const context = await repository.context({ anonymousSessionId: sessionId, analysisId, candidateId, now: NOW });
    if (context.kind !== "READY") throw new Error("context-unavailable");
    expect(context.value.facts).toEqual(facts);
    const dependencies = { rule: ruleSet, push: pushResult, variable: varResult, hash: async (input: string) => Uint8Array.from(digest("sha256").update(input).digest()) };
    const legacy = await assessment(dependencies)({
      ruleVersionId: context.value.ruleVersionId, push: context.value.facts.push, variable: context.value.facts.variable,
      observed: context.value.facts.observed, options: { corner_kick_review: false },
    });
    if (legacy.kind !== "EVALUATED") throw new Error("legacy-evaluation-unavailable");
    expect(legacy.value.varAssessment?.notReviewableReason).toBe("COMPETITION_OPTION_NOT_ADOPTED");
    const prior = await repository.save({
      anonymousSessionId: sessionId, analysisId, candidateId, factRevisionId: factId,
      ruleVersionId: context.value.ruleVersionDbId, analysisStateVersion: context.value.analysisStateVersion,
      facts, evaluation: legacy.value, ruleEngineVersion: "rule-engine-v1", evaluationSchemaVersion: 1, now: NOW,
    });
    if (prior.kind !== "CREATED") throw new Error("legacy-decision-unavailable");

    const reevaluatedAt = new Date(new Date(NOW).getTime() + 1000);
    const decide = evaluateDecision({
      clock: { now: () => reevaluatedAt }, repository,
      run: assessment({ ...dependencies, competitionRule: combineCompetitionRules }),
    });
    const current = await decide({ anonymousSessionId: sessionId, analysisId, candidateId });
    expect(current.kind).toBe("CREATED");
    if (current.kind !== "CREATED") return;
    expect(current.decisionId).not.toBe(prior.decisionId);
    const readHistory = () => database.sql<{
      id: string; incident_candidate_id: string; fact_revision_id: string; applied_rule_version_id: string;
      fact_signature: string; rule_engine_version: string; citations: RuleCitation[]; evaluation_snapshot: EvaluationResult;
    }[]>`
      select id, incident_candidate_id, fact_revision_id, applied_rule_version_id,
             encode(fact_signature, 'hex') as fact_signature, rule_engine_version, citations, evaluation_snapshot
      from decision_results where incident_candidate_id = ${candidateId}
      order by rule_engine_version
    `;
    const history = await readHistory();
    expect(history).toHaveLength(2);
    for (const item of history) {
      expect(item).toMatchObject({
        incident_candidate_id: candidateId, fact_revision_id: factId,
        applied_rule_version_id: context.value.ruleVersionDbId, fact_signature: legacy.value.factSignature,
      });
    }
    const previous = history.find((item) => item.id === prior.decisionId);
    expect(previous?.rule_engine_version).toBe("rule-engine-v1");
    expect(previous?.citations).toEqual(legacy.value.citations);
    expect(previous?.evaluation_snapshot).toEqual(legacy.value);
    const latest = history.find((item) => item.id === current.decisionId);
    expect(latest?.rule_engine_version).toBe("rule-engine-v2-competition");
    expect(latest?.evaluation_snapshot.varAssessment?.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
    const leagueCitations = latest?.citations.filter((item) => item.authority === "KLEAGUE") ?? [];
    expect(leagueCitations.length).toBeGreaterThan(0);
    expect(leagueCitations.every((item) => item.ruleId.startsWith(`${versionId}-`) && item.edition === "2026")).toBe(true);
    const result = await statusStore(database).analysis({ anonymousSessionId: sessionId, analysisId, now: reevaluatedAt.toISOString() });
    expect(result?.candidates[0]?.judgment?.varAssessment.notReviewableReason).toBe("OUTSIDE_REVIEWABLE_CATEGORIES");
    expect(result?.candidates[0]?.judgment?.citations).toEqual(latest?.citations);
    await expect(decide({ anonymousSessionId: sessionId, analysisId, candidateId })).resolves.toEqual({
      kind: "REPLAYED", decisionId: current.decisionId,
    });
    expect(await readHistory()).toEqual(history);
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
    const run = assessment({ rule: ruleSet, competitionRule: combineCompetitionRules, push: pushResult, variable: varResult, hash: async (input) => Uint8Array.from(digest("sha256").update(input).digest()) });
    const judged = await run({ ruleVersionId: context.value.ruleVersionId, ...(context.value.competition ? { competition: context.value.competition } : {}), push: facts.push, variable: facts.variable, observed: facts.observed, options: context.value.competitionOptions });
    expect(judged.kind).toBe("EVALUATED");
    if (judged.kind !== "EVALUATED") return;

    await expect(repository.save({ anonymousSessionId: sessionId, analysisId, candidateId, factRevisionId: factId, ruleVersionId: context.value.ruleVersionDbId, analysisStateVersion: context.value.analysisStateVersion, facts, evaluation: judged.value, ruleEngineVersion: "rule-engine-v1", evaluationSchemaVersion: 1, now: NOW })).resolves.toMatchObject({ kind: "STALE_ANALYSIS" });

    const [analysis] = await database.sql<{ status: string; state_version: number }[]>`select status, state_version from analyses where id = ${analysisId}`;
    expect(analysis).toEqual({ status: "FAILED", state_version: 1 });
  });
});
