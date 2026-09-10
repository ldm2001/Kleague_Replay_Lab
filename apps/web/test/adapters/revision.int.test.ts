import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluationStore, statusStore } from "@replay/adapters";
import { assessment } from "@replay/application";
import { client } from "@replay/database";
import { combineCompetitionRules, ruleSet } from "@replay/rule-data";
import { pushResult, varResult } from "@replay/rule-engine";
import { judgment } from "../fixtures/result";

// 별도 테스트 DB에서 사실 버전과 판정의 연결 확인
describe.skipIf(!process.env.DATABASE_URL)("사실 버전", () => {
  const database = process.env.DATABASE_URL ? client() : null;
  if (!database) return;
  const store = evaluationStore(database);
  const status = statusStore(database);
  const now = "2026-09-05T00:00:00.000Z";
  const expires = "2026-09-06T00:00:00.000Z";
  let session: string;
  let video: string;
  let analysis: string;
  let candidate: string;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const engine = assessment({ rule: ruleSet, competitionRule: combineCompetitionRules, push: pushResult, variable: varResult, hash: async (value) => hash(value) });

  beforeEach(async () => {
    // 테스트별 소유 세션과 장면 생성
    session = randomUUID();
    video = randomUUID();
    analysis = randomUUID();
    candidate = randomUUID();
    await database.sql`insert into anonymous_sessions (id, token_hash, created_at, expires_at) values (${session}, ${hash(session)}, ${now}, ${expires})`;
    await database.sql`insert into video_assets (id, anonymous_session_id, object_key, content_sha256, content_type, size_bytes, status, rights_confirmed_at, created_at, expires_at) values (${video}, ${session}, ${video}, ${hash(video)}, 'video/mp4', 100, 'VALID', ${now}, ${now}, ${expires})`;
    const [version] = await database.sql`select id from competition_rule_versions where competition = 'K리그1' and season = '2026' and ifab_edition = '2026-27' limit 1`;
    await database.sql`insert into analyses (id, anonymous_session_id, video_asset_id, status, retention_class, applied_rule_version_id, created_at, expires_at) values (${analysis}, ${session}, ${video}, 'CANDIDATES_READY', 'TEMPORARY', ${version!.id}, ${now}, ${expires})`;
    await database.sql`insert into incident_candidates (id, analysis_id, candidate_index, review_scenario, start_ms, end_ms, camera_sufficiency, review_status) values (${candidate}, ${analysis}, 1, 'GOAL_DISALLOWED', 0, 2000, 'HIGH', 'UNREVIEWED')`;
  });
  afterEach(async () => {
    // 생성한 세션의 테스트 데이터만 제거
    await database.sql`delete from analyses where anonymous_session_id = ${session}`;
    await database.sql`delete from video_assets where anonymous_session_id = ${session}`;
    await database.sql`delete from anonymous_sessions where id = ${session}`;
  });
  afterAll(() => database.close());

  const revision = (key: string, expected: string | null = null, facts = judgment.facts) => ({
    anonymousSessionId: session, analysisId: analysis, candidateId: candidate,
    expectedFactRevisionId: expected, facts, keyHash: hash(key), requestHash: hash(JSON.stringify({ expected, facts })), now,
  });
  const decision = async () => {
    // 저장 직전 평가 문맥 확보
    const context = await store.context({ anonymousSessionId: session, analysisId: analysis, candidateId: candidate, now });
    if (context.kind !== "READY") throw new Error("context-unavailable");
    const result = await engine({ ruleVersionId: context.value.ruleVersionId, ...(context.value.competition ? { competition: context.value.competition } : {}), push: context.value.facts.push, variable: context.value.facts.variable, observed: context.value.facts.observed, options: context.value.competitionOptions });
    if (result.kind !== "EVALUATED") throw new Error("evaluation-unavailable");
    return { anonymousSessionId: session, analysisId: analysis, candidateId: candidate, analysisStateVersion: context.value.analysisStateVersion, factRevisionId: context.value.factRevisionId, ruleVersionId: context.value.ruleVersionDbId, facts: context.value.facts, evaluation: result.value, ruleEngineVersion: "test-v1", evaluationSchemaVersion: 1, now };
  };

  it("수정 후 재평가", async () => {
    // 첫 판정 저장
    const initial = await store.patch(revision("first"));
    if (initial.kind !== "CREATED") throw new Error("revision-unavailable");
    // 판정 저장 전에도 최신 사실과 Revision 조회 가능
    expect(await status.analysis({ anonymousSessionId: session, analysisId: analysis, now })).toMatchObject({
      candidates: [{ factRevisionId: initial.factRevisionId, facts: judgment.facts, judgment: null }],
    });
    const previous = await decision();
    expect(await store.save(previous)).toMatchObject({ kind: "CREATED" });
    // 새 사실을 저장한 뒤 기존 판정을 숨김
    const changed = structuredClone(judgment.facts);
    changed.push.contactDetected.value = false;
    expect(await store.patch(revision("second", initial.factRevisionId, changed))).toMatchObject({ kind: "CREATED" });
    const view = await status.analysis({ anonymousSessionId: session, analysisId: analysis, now });
    expect(view).toMatchObject({ status: "CANDIDATES_READY", judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0, candidates: [{ judgment: null }] });
    expect(await store.save(previous)).toMatchObject({ kind: "STALE_FACT_REVISION" });
    // 새 사실의 판정 완료와 이력 보존 확인
    expect(await store.save(await decision())).toMatchObject({ kind: "CREATED" });
    const updated = await status.analysis({ anonymousSessionId: session, analysisId: analysis, now });
    expect(updated).toMatchObject({ status: "COMPLETED", judgmentStatus: "EVALUATED", evaluatedCount: 1 });
    expect(updated?.candidates[0]?.judgment?.facts.push.contactDetected.value).toBe(false);
    // 실제 판정 저장 경로에서 IFAB와 K리그 근거 연결 확인
    expect(updated?.candidates[0]?.judgment?.citations.map((item) => item.authority)).toEqual(expect.arrayContaining(["IFAB", "KLEAGUE"]));
    const [history] = await database.sql`select count(*)::int as count from decision_results where analysis_id = ${analysis}`;
    expect(history?.count).toBe(2);
  });

  it("모델 관찰과 실제 샷 조회", async () => {
    // 모델 관찰을 판정과 별도 보존
    const observation = { model: "gemma3:12b", category: "UNKNOWN", contact: "UNKNOWN", displacement: "uncertain", camera: "LOW", summary: "가림으로 접촉 확인 어려움", timestamps: [200, 800, 1400] };
    await database.sql`update incident_candidates set observation = ${JSON.stringify(observation)}::jsonb where id = ${candidate}`;
    const shot = randomUUID();
    await database.sql`insert into shots (id, analysis_id, shot_index, start_ms, end_ms, playback_speed, is_replay) values (${shot}, ${analysis}, 0, 0, 3000, 'UNKNOWN', false)`;
    const view = await status.analysis({ anonymousSessionId: session, analysisId: analysis, now });
    expect(view).toMatchObject({ judgmentStatus: "NOT_EVALUATED", candidates: [{ observation, judgment: null, shots: [{ id: shot, index: 0, startMs: 0, endMs: 3000 }] }] });
    // 다른 세션의 관찰 조회 차단
    expect(await status.analysis({ anonymousSessionId: randomUUID(), analysisId: analysis, now })).toBeNull();
  });

  it("동일 요청 동시 저장", async () => {
    // 같은 키의 동시 요청은 한 번만 생성
    const command = revision("shared");
    let unlock!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const holder = database.sql.begin(async (transaction) => {
      await transaction`select id from anonymous_sessions where id = ${session} for update`;
      ready();
      await gate;
    });
    await locked;
    const pending = Promise.all([store.patch(command), store.patch(command)]);
    // 두 요청 모두 잠금 대기에 진입한 뒤 함께 진행
    try {
      const deadline = Date.now() + 3000;
      let count = 0;
      while (Date.now() < deadline) {
        const [row] = await database.sql`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `;
        count = row!.count;
        if (count >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(count).toBeGreaterThanOrEqual(2);
    } finally {
      unlock();
      await holder;
    }
    const results = await pending;
    expect(results.map((item) => item.kind).sort()).toEqual(["CREATED", "REPLAYED"]);
  });
});
