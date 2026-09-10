import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { report, result, type AnalysisPayload } from "@replay/application";
import { broadcastCueData, sceneEventData, WORKER_PROTOCOL, type BroadcastCue } from "@replay/shared-types";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";
import { knownVideoSource } from "../../src/adapters/known-video-sources";
import { judgment } from "../fixtures/result";

const databaseUrl = process.env.DATABASE_URL;
const NOW = "2030-01-01T12:00:00.000Z";
const EXPIRES = "2030-01-02T12:00:00.000Z";
const SOURCE_SHA256 = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";
const hasher = { sha256: async (value: string) => new Uint8Array(createHash("sha256").update(value).digest()) };
const broadcastCue: BroadcastCue = {
  kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 600, endMs: 1400,
  evidenceTimestampsMs: [600, 1000, 1400],
};

function synthetic(analysisId: string, jobId: string): AnalysisPayload {
  return {
    kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [],
    shots: [{ index: 0, startMs: 0, endMs: 2000, playbackSpeed: "UNKNOWN", isReplay: false, cameraAngle: null }],
    candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000, confidence: 0.5,
      cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [0], ...{ broadcastCue },
    }],
    evidence: [{ candidateIndex: 1, kind: "CLIP", objectKey: `evidence/${analysisId}/${jobId}/clip.mp4`,
      contentSha256: "ab".repeat(32), startMs: 500, endMs: 1500, width: 640, height: 360 }],
  };
}

describe("broadcast scope adapter contracts", () => {
  const candidateRow = {
    id: "11111111-1111-4111-8111-111111111111", candidate_index: 1, category: "OTHER",
    start_ms: 500, end_ms: 1500, anchor_ms: 1000, signal_score: 0.5, camera_sufficiency: "MEDIUM",
    reasons: [], broadcast_cue: broadcastCue,
  };
  const evidenceRow = { id: "22222222-2222-4222-8222-222222222222", candidate_index: 1, kind: "CLIP", start_ms: 500, end_ms: 1500 };

  async function status(options: { source?: string; pipeline?: string | null; candidates?: unknown[]; evidence?: unknown[] } = {}) {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const queue = [[{
      video_asset_id: "33333333-3333-4333-8333-333333333333", video_status: "VALID", validation_error_code: null,
      analysis_id: "44444444-4444-4444-8444-444444444444", analysis_status: "COMPLETED",
      pipeline_version: options.pipeline === undefined ? "video-baseline-v1" : options.pipeline,
      source_sha256: options.source ?? SOURCE_SHA256, stage: "SUCCEEDED", progress_percent: 100,
      failure_code: null, limitations: [],
    }], options.candidates ?? [candidateRow], options.evidence ?? [evidenceRow]];
    const repository = new StatusStore({ db: { execute: async (statement: SQL) => {
      queries.push(new PgDialect().sqlToQuery(statement));
      return queue.shift() ?? [];
    } } } as never);
    const view = await repository.status({ anonymousSessionId: randomUUID(), videoAssetId: randomUUID(), now: NOW });
    return { view: view?.analysis, queries };
  }

  it("computes competition scope from a stored source hash and covering clip without a judgment", async () => {
    const { view, queries } = await status();
    expect(knownVideoSource(SOURCE_SHA256)).toMatchObject({ competition: "K리그2", season: "2026" });
    expect(view).toMatchObject({
      judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0,
      diagnostics: { rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1 },
      candidates: [{ broadcastCue, facts: null, judgment: null, varScopeEvaluation: {
        kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED", included: true,
        competition: "K리그2", season: "2026", evidenceIds: [evidenceRow.id],
        citations: expect.arrayContaining([expect.objectContaining({ authority: "KLEAGUE", law: "25", edition: "2026" })]),
      } }],
    });
    expect(view?.candidates[0]?.evidence).toEqual([{ evidenceId: evidenceRow.id, kind: "CLIP" }]);
    expect(queries[0]?.sql).toContain("encode(video.content_sha256, 'hex') as source_sha256");
    expect(queries[1]?.sql).toContain("candidate.broadcast_cue");
    expect(queries[2]?.sql).toContain("asset.start_ms, asset.end_ms");
  });

  it.each([
    { source: "ab".repeat(32) },
    { evidence: [] },
    { evidence: [{ ...evidenceRow, kind: "FRAME" }] },
    { evidence: [{ ...evidenceRow, candidate_index: 2 }] },
    { evidence: [{ ...evidenceRow, start_ms: 601 }] },
    { evidence: [{ ...evidenceRow, end_ms: 1399 }] },
  ])("retains recognition but does not complete scope without verified source and covering clip: %j", async (options) => {
    const { view } = await status(options);
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue, varScopeEvaluation: null, judgment: null });
    expect(view?.diagnostics).toMatchObject({ rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1 });
  });

  it("counts each technical exclusion once without granting it broadcast scope", async () => {
    const { view } = await status({ candidates: [candidateRow,
      { ...candidateRow, candidate_index: 2, broadcast_cue: null },
      { ...candidateRow, candidate_index: 3, start_ms: -1 },
    ] });
    expect(view?.candidates).toHaveLength(1);
    expect(view?.diagnostics).toMatchObject({ rawProposalCount: 1, invalidOutputCount: 1, recognizedEventCount: 1 });
  });

  it("counts a candidate with both corner and broadcast evidence as one recognized scene", async () => {
    const { view } = await status({ candidates: [{ ...candidateRow, scene_event: {
      kind: "CORNER_KICK", status: "OBSERVED", method: "corner-geometry-motion-v1",
      startMs: 600, endMs: 1400, restartMs: 1000, evidenceTimestampsMs: [600, 900, 1100, 1400],
    } }] });
    expect(view?.candidates).toHaveLength(1);
    expect(view?.diagnostics).toMatchObject({ rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1 });
  });

  it.each(["USER", "MODEL"])("does not substitute %s facts for a missing verified video source", async (factSource) => {
    const { view } = await status({ source: "", candidates: [{ ...candidateRow,
      fact_revision_id: randomUUID(), fact_source: factSource, fact_snapshot: judgment.facts,
    }] });
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue, varScopeEvaluation: null, judgment: null });
  });

  it("does not grant independent scope to legacy pipeline-null history", async () => {
    const { view } = await status({ pipeline: null });
    expect(view).not.toHaveProperty("diagnostics");
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue, varScopeEvaluation: null });
  });

  it("reads older null broadcast columns without changing legacy candidate visibility", async () => {
    const { view } = await status({ pipeline: null, candidates: [{ ...candidateRow, broadcast_cue: null }] });
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue: null, varScopeEvaluation: null });
  });

  it("stores broadcast JSON separately from review scenario, tracking, and judgments", async () => {
    const jobId = randomUUID(), analysisId = randomUUID();
    const tokenHash = await hasher.sha256("test-lease");
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const repository = new JobStore({ db: { transaction: async (operation: (tx: unknown) => unknown) => operation({
      execute: async (statement: SQL) => {
        queries.push(new PgDialect().sqlToQuery(statement));
        return queries.length === 1 ? [{ id: jobId, status: "PROCESSING", job_type: "ANALYZE_VIDEO",
          job_revision: 1, attempt: 1, lease_owner: "test-worker", lease_token_hash: Buffer.from(tokenHash),
          lease_until: EXPIRES, analysis_id: analysisId }] : [];
      },
    }) } } as never);
    const payload = { ...synthetic(analysisId, jobId), evidence: [] };
    await expect(repository.result({ jobId, workerId: "test-worker", jobRevision: 1,
      leaseTokenHash: tokenHash, now: NOW, payload })).resolves.toEqual({ kind: "ACCEPTED" });
    const insert = queries.find((query) => query.sql.includes("insert into incident_candidates"));
    expect(insert?.sql).toContain("broadcast_cue");
    expect(insert?.params).toContain(JSON.stringify(broadcastCue));
    expect(insert?.params).toContain("OTHER");
    expect(queries.some((query) => query.sql.includes("insert into decision_results"))).toBe(false);
  });
});

describe.skipIf(!databaseUrl)("Worker broadcast -> API -> PostgreSQL -> competition scope", () => {
  if (!databaseUrl) return;
  const database = client(databaseUrl);
  const sessions: string[] = [];
  afterEach(async () => {
    for (const id of sessions.splice(0)) {
      await database.sql`delete from analyses where anonymous_session_id = ${id}`;
      await database.sql`delete from video_assets where anonymous_session_id = ${id}`;
      await database.sql`delete from anonymous_sessions where id = ${id}`;
    }
  });
  afterAll(async () => { await database.close(); });

  async function setup(sourceSha256 = "ab".repeat(32)) {
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    sessions.push(sessionId);
    await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, ${NOW}, ${EXPIRES})`;
    // UploadStore computes this hash from uploaded bytes; the integration fixture supplies that stored precondition.
    await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at, competition, season)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from(sourceSha256, "hex")}, 'video/mp4',
      100, 'VALID', ${NOW}, ${NOW}, ${EXPIRES}, 'UNKNOWN', 'UNKNOWN')`;
    await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
      pipeline_version, media_policy_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', 'video-baseline-v1', 'media-v1', ${NOW}, ${EXPIRES})`;
    await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
      attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
      values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'test-worker',
      ${Buffer.from(await hasher.sha256("test-lease"))}, ${EXPIRES}, ${NOW}, ${NOW})`;
    return { sessionId, analysisId, jobId };
  }

  async function send(jobId: string, payload: AnalysisPayload) {
    const operation = result({ clock: { now: () => new Date(NOW) }, hasher, repository: new JobStore(database) });
    return acceptResult(new Request("http://local/internal/jobs/result", {
      method: "POST", headers: { "content-type": "application/json", "x-worker-key": "test-key", "x-worker-protocol": WORKER_PROTOCOL },
      body: JSON.stringify({ workerId: "test-worker", jobRevision: 1, leaseToken: "test-lease", payload }),
    }), { jobId }, { key: "test-key", result: operation } as JobApiDependencies);
  }

  async function readInternal(sessionId: string, analysisId: string) {
    return new StatusStore(database).analysis({ anonymousSessionId: sessionId, analysisId, now: NOW });
  }

  it.each(["ab".repeat(32), SOURCE_SHA256])("persists cue and computes scope only for registered source %s", async (sourceSha256) => {
    const ids = await setup(sourceSha256);
    const payload = synthetic(ids.analysisId, ids.jobId);
    expect((await send(ids.jobId, payload)).status).toBe(200);
    const stored = await database.sql`select broadcast_cue, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
    expect(stored).toEqual([expect.objectContaining({ broadcast_cue: broadcastCue, tracking: null, scene_event: null })]);
    const view = await readInternal(ids.sessionId, ids.analysisId);
    expect(view?.diagnostics).toMatchObject({ rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1 });
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue, judgment: null, facts: null });
    if (sourceSha256 === SOURCE_SHA256) {
      expect(view?.candidates[0]?.varScopeEvaluation).toMatchObject({
        status: "COMPLETED", topic: "GOAL_RELATED", included: true, competition: "K리그2", season: "2026",
        citations: expect.arrayContaining([expect.objectContaining({ authority: "KLEAGUE", law: "25", edition: "2026" })]),
      });
    } else expect(view?.candidates[0]?.varScopeEvaluation).toBeNull();
    expect(await database.sql`select id from decision_results where analysis_id = ${ids.analysisId}`).toHaveLength(0);
    expect(await readInternal(randomUUID(), ids.analysisId)).toBeNull();
  });

  it("rejects an out-of-candidate broadcast cue before any output is written", async () => {
    const ids = await setup(SOURCE_SHA256);
    const baseline = synthetic(ids.analysisId, ids.jobId);
    const payload = { ...baseline, candidates: [{ ...baseline.candidates[0]!, broadcastCue: { ...broadcastCue, endMs: 1501 } }] };
    expect((await send(ids.jobId, payload)).status).toBe(400);
    expect(await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`).toHaveLength(0);
    expect(await database.sql`select id from shots where analysis_id = ${ids.analysisId}`).toHaveLength(0);
  });

  it("retains legacy null-column reads without manufacturing scope", async () => {
    const ids = await setup(SOURCE_SHA256);
    const baseline = synthetic(ids.analysisId, ids.jobId);
    expect((await send(ids.jobId, { ...baseline, candidates: [{ ...baseline.candidates[0]!, broadcastCue: null }] })).status).toBe(200);
    await database.sql`update analyses set pipeline_version = null where id = ${ids.analysisId}`;
    const view = await readInternal(ids.sessionId, ids.analysisId);
    expect(view).not.toHaveProperty("diagnostics");
    expect(view?.candidates).toHaveLength(1);
    expect(view?.candidates[0]).toMatchObject({ broadcastCue: null, varScopeEvaluation: null, judgment: null });
  });

  it.skipIf(!process.env.REPLAY_BROADCAST_REPORT)("runs actual Python broadcast evidence through API, storage, and scope", async () => {
    const reportPath = resolve(process.env.REPLAY_BROADCAST_REPORT!);
    const context = JSON.parse(readFileSync(resolve(dirname(reportPath), "tracking/context-summary.json"), "utf-8")) as { source_sha256: string };
    expect(knownVideoSource(context.source_sha256)).not.toBeNull();
    const ids = await setup(context.source_sha256);
    const code = `import json,sys
from pathlib import Path
from replay_video.runner import report
class LocalStorage:
    def evidence(self,item,entries):
        return {"kind":"GRANTED","items":[{"name":e["name"],"objectKey":f"evidence/{sys.argv[2]}/{sys.argv[3]}/{e['name']}","uploadUrl":"local"} for e in entries]}
    def put(self,url,source,content_type):
        assert source.is_file() and source.stat().st_size > 0
print(json.dumps(report(LocalStorage(),{},Path(sys.argv[1]))))`;
    const payload = JSON.parse(execFileSync("python3", ["-c", code, reportPath, ids.analysisId, ids.jobId], {
      env: { ...process.env, PYTHONPATH: resolve("apps/video-worker/src") }, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024,
    })) as AnalysisPayload;
    const cues = payload.candidates.filter((candidate) => broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs));
    expect(cues.length).toBeGreaterThan(0);
    for (const candidate of cues) {
      expect(payload.evidence?.some((asset) => asset.candidateIndex === candidate.index && asset.kind === "CLIP" &&
        asset.startMs <= candidate.broadcastCue!.startMs && asset.endMs >= candidate.broadcastCue!.endMs)).toBe(true);
    }
    expect((await send(ids.jobId, payload)).status).toBe(200);
    const view = await readInternal(ids.sessionId, ids.analysisId);
    const recognized = payload.candidates.filter((candidate) => broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs) ||
      sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs));
    expect(view?.diagnostics).toMatchObject({ rawProposalCount: payload.candidates.length - recognized.length,
      invalidOutputCount: 0, recognizedEventCount: recognized.length });
    expect(view?.candidates.filter((candidate) => candidate.varScopeEvaluation?.status === "COMPLETED")).toHaveLength(cues.length);
    expect(view?.candidates.every((candidate) => candidate.judgment === null)).toBe(true);
    const stored = await database.sql`select candidate_index, broadcast_cue, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
    expect(stored).toHaveLength(payload.candidates.length);
    for (const input of payload.candidates) {
      const row = stored.find((item) => item.candidate_index === input.index);
      expect(row?.broadcast_cue).toEqual(input.broadcastCue ?? null);
      expect(row?.tracking).toEqual(input.tracking ?? null);
      expect(row?.scene_event).toEqual(input.sceneEvent ?? null);
    }
    expect(await database.sql`select id from decision_results where analysis_id = ${ids.analysisId}`).toHaveLength(0);
    const publicView = await report({ clock: { now: () => new Date(NOW) }, repository: new StatusStore(database) })({
      anonymousSessionId: ids.sessionId, analysisId: ids.analysisId,
    });
    expect(publicView).not.toBeNull();
    if (!publicView || "kind" in publicView) throw new Error("public-broadcast-analysis-not-returned");
    expect(publicView).toMatchObject({ resultPolicy: "COMPLETED_ONLY", status: "COMPLETED",
      judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0, completedScopeCount: cues.length });
    expect(publicView).not.toHaveProperty("diagnostics");
    expect(publicView).not.toHaveProperty("filterSummary");
    expect(publicView.candidates).toHaveLength(cues.length);
    expect(publicView.candidates.map((candidate) => candidate.index)).toEqual([...cues]
      .sort((first, second) => first.startMs - second.startMs || first.index - second.index)
      .map((candidate) => candidate.index));
    for (const candidate of publicView.candidates) {
      expect(candidate.judgment).toBeNull();
      expect(candidate).not.toHaveProperty("facts");
      expect(candidate).not.toHaveProperty("observation");
      expect(candidate).not.toHaveProperty("filter");
      expect(candidate).not.toHaveProperty("sceneEvent");
      expect(candidate.varScopeEvaluation).toMatchObject({
        kind: "COMPETITION_VAR_SCOPE", status: "COMPLETED", topic: "GOAL_RELATED", included: true,
        competition: "K리그2", season: "2026", ruleVersionId: "kleague2-2026",
        provenance: { sourceSha256: context.source_sha256, origin: "VIDEO_CUE_AND_COMPETITION_RULES" },
        notAssessed: expect.arrayContaining(["FOUL_DECISION", "REFEREE_DECISION_CORRECTNESS", "VAR_CHECK_PERFORMED"]),
      });
      const scope = candidate.varScopeEvaluation!;
      expect(scope.citations.length).toBeGreaterThan(0);
      expect(scope.citations.every((citation) => citation.authority === "KLEAGUE" && citation.law === "25" &&
        citation.edition === "2026" && citation.ruleId.startsWith("kleague2-2026-"))).toBe(true);
      expect(scope.evidenceIds.length).toBeGreaterThan(0);
      expect(scope.evidenceIds.every((id) => candidate.evidence?.some((asset) => asset.evidenceId === id && asset.kind === "CLIP"))).toBe(true);
    }
    if (process.env.REPLAY_SCOPE_OUTPUT) writeFileSync(process.env.REPLAY_SCOPE_OUTPUT, `${JSON.stringify(publicView, null, 2)}\n`, "utf-8");
  });
});
