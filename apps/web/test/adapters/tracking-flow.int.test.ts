import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { JobStore, StatusStore } from "@replay/adapters";
import { result, report, type AnalysisPayload } from "@replay/application";
import { sceneEventData, WORKER_PROTOCOL, type SceneEvent } from "@replay/shared-types";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";

const databaseUrl = process.env.DATABASE_URL;
const NOW = "2030-01-01T12:00:00.000Z";
const EXPIRES = "2030-01-02T12:00:00.000Z";
const hasher = { sha256: async (value: string) => new Uint8Array(createHash("sha256").update(value).digest()) };
const cornerEvent: SceneEvent = {
  kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
  evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};

describe.skipIf(!databaseUrl)("Worker tracking -> API -> PostgreSQL -> rules", () => {
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

  async function setup() {
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    sessions.push(sessionId);
    await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, ${NOW}, ${EXPIRES})`;
    await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at, competition, season)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${Buffer.from(randomUUID())}, 'video/mp4',
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

  function synthetic(analysisId: string, jobId: string): AnalysisPayload {
    return {
      kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [],
      shots: [{ index: 0, startMs: 0, endMs: 2000, playbackSpeed: "UNKNOWN", isReplay: false, cameraAngle: null }],
      candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000, confidence: 0.5,
        cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [0],
        tracking: { version: "ball-path-v1", coverage: "COMPLETE", sampleCount: 20, selectedCount: 18, cameraCount: 16, motionOnsetsMs: [1200] },
      }],
      evidence: [{ candidateIndex: 1, kind: "FRAME", objectKey: `evidence/${analysisId}/${jobId}/frame.jpg`,
        contentSha256: "ab".repeat(32), startMs: 500, endMs: 1500, width: 640, height: 360 }],
    };
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

  async function readPublic(sessionId: string, analysisId: string) {
    return report({ clock: { now: () => new Date(NOW) }, repository: new StatusStore(database) })({ anonymousSessionId: sessionId, analysisId });
  }

  function expectCompletedOnly(view: Awaited<ReturnType<typeof readPublic>>) {
    expect(view).toMatchObject({
      status: "COMPLETED", resultPolicy: "COMPLETED_ONLY", mode: "VISUAL_CHANGE_BASELINE",
      judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0, candidates: [],
    });
    expect(view).not.toHaveProperty("diagnostics");
    expect(view).not.toHaveProperty("filterSummary");
  }

  it("persists raw proposal tracking without presenting it as a recognized scene", async () => {
    const ids = await setup();
    const payload = synthetic(ids.analysisId, ids.jobId);
    expect((await send(ids.jobId, payload)).status).toBe(200);
    const view = await readInternal(ids.sessionId, ids.analysisId);
    const stored = await database.sql`select tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ tracking: payload.candidates[0]!.tracking, scene_event: null });
    expect(view).toMatchObject({
      status: "COMPLETED", judgmentStatus: "NOT_EVALUATED", candidates: [],
      filterSummary: { checkedCount: 1, observedCount: 0, applicableCount: 0, excludedCount: 0, undeterminedCount: 1 },
      diagnostics: { rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 0,
        supportedEventTypes: ["CORNER_KICK"],
        reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR", "UNRECOGNIZED_PROPOSALS"]),
      },
    });
    expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
    expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(view);
    expect(await readInternal(randomUUID(), ids.analysisId)).toBeNull();
    expect(await readPublic(randomUUID(), ids.analysisId)).toBeNull();
  });

  it("rejects out-of-scene tracking before any candidate is stored", async () => {
    const ids = await setup();
    const payload = synthetic(ids.analysisId, ids.jobId);
    const candidate = payload.candidates[0]!;
    const response = await send(ids.jobId, { ...payload, candidates: [{ ...candidate,
      tracking: { ...candidate.tracking!, motionOnsetsMs: [1501] },
    }] });
    expect(response.status).toBe(400);
    expect(await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`).toHaveLength(0);
  });

  it("persists a corner observation and returns reference conditions when match rules are unknown", async () => {
    const ids = await setup();
    const baseline = synthetic(ids.analysisId, ids.jobId);
    const payload = { ...baseline, candidates: [{ ...baseline.candidates[0]!, sceneEvent: cornerEvent }] };
    expect((await send(ids.jobId, payload)).status).toBe(200);
    const [stored] = await database.sql`select scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
    expect(stored?.scene_event).toEqual(cornerEvent);
    const internalView = await readInternal(ids.sessionId, ids.analysisId);
    expect(internalView).toMatchObject({
      status: "COMPLETED", judgmentStatus: "NOT_EVALUATED", rule: null,
      filterSummary: { checkedCount: 1, observedCount: 1, applicableCount: 0, excludedCount: 0, undeterminedCount: 0 },
      candidates: [{ sceneEvent: cornerEvent, judgment: null, filter: {
        status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true, ruleReferences: [],
        reasonCodes: expect.arrayContaining(["SITUATION_OBSERVED", "RULE_CONTEXT_UNVERIFIED"]),
        conditions: expect.arrayContaining([expect.objectContaining({ code: "CORNER_RESTART", status: "UNVERIFIED" })]),
      } }],
    });
    expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
    expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(internalView);
  });

  it("rejects an event outside its candidate before storing any pipeline output", async () => {
    const ids = await setup();
    const payload = synthetic(ids.analysisId, ids.jobId);
    const response = await send(ids.jobId, { ...payload, candidates: [{ ...payload.candidates[0]!,
      sceneEvent: { ...cornerEvent, endMs: 1501 },
    }] });
    expect(response.status).toBe(400);
    expect(await database.sql`select id from incident_candidates where analysis_id = ${ids.analysisId}`).toHaveLength(0);
    expect(await database.sql`select id from shots where analysis_id = ${ids.analysisId}`).toHaveLength(0);
  });

  it("keeps a valid scene observation internally when rules are undetermined", async () => {
    const ids = await setup();
    const baseline = synthetic(ids.analysisId, ids.jobId);
    const payload = { ...baseline, candidates: [{ ...baseline.candidates[0]!, sceneEvent: cornerEvent }], evidence: [] };
    expect((await send(ids.jobId, payload)).status).toBe(200);
    const internalView = await readInternal(ids.sessionId, ids.analysisId);
    expect(internalView).toMatchObject({
      judgmentStatus: "NOT_EVALUATED", rule: null,
      filterSummary: { checkedCount: 1, observedCount: 0, applicableCount: 0, excludedCount: 0, undeterminedCount: 1 },
      diagnostics: { rawProposalCount: 0, invalidOutputCount: 0, recognizedEventCount: 1, supportedEventTypes: ["CORNER_KICK"] },
      candidates: [{ sceneEvent: cornerEvent, facts: null, judgment: null, evidence: [], filter: {
        status: "UNDETERMINED", reasonCodes: expect.arrayContaining(["EVIDENCE_UNAVAILABLE", "RULE_CONTEXT_UNVERIFIED"]),
      } }],
    });
    expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
    expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(internalView);
  });

  it("reads older pipeline results with missing tracking", async () => {
    const ids = await setup();
    const payload = synthetic(ids.analysisId, ids.jobId);
    expect((await send(ids.jobId, { ...payload, candidates: [{ ...payload.candidates[0]!, tracking: null, sceneEvent: cornerEvent }] })).status).toBe(200);
    expect(await readInternal(ids.sessionId, ids.analysisId)).toMatchObject({ candidates: [{
      tracking: null, sceneEvent: cornerEvent, filter: { trackingStatus: "UNAVAILABLE" },
    }] });
    expectCompletedOnly(await readPublic(ids.sessionId, ids.analysisId));
    await database.sql`update analyses set pipeline_version = null where id = ${ids.analysisId}`;
    const legacyView = await readPublic(ids.sessionId, ids.analysisId);
    expect(legacyView).toEqual(await readInternal(ids.sessionId, ids.analysisId));
    expect(legacyView).not.toHaveProperty("resultPolicy");
    expect(legacyView).not.toHaveProperty("diagnostics");
    expect(legacyView).toMatchObject({
      filterSummary: { checkedCount: 1, observedCount: 1 },
      candidates: [{ tracking: null, sceneEvent: cornerEvent, filter: { trackingStatus: "UNAVAILABLE" } }],
    });
  });

  it.skipIf(!process.env.REPLAY_PIPELINE_REPORT)("runs the actual Python report through the same API and rules path", async () => {
    const ids = await setup();
    // 실제 runner 변환기를 사용하고 저장소 업로드만 로컬 파일 존재 검사로 대체한다
    const code = `import json,sys
from pathlib import Path
from replay_video.runner import report
class LocalStorage:
    def evidence(self,item,entries):
        return {"kind":"GRANTED","items":[{"name":e["name"],"objectKey":f"evidence/{sys.argv[2]}/{sys.argv[3]}/{e['name']}","uploadUrl":"local"} for e in entries]}
    def put(self,url,source,content_type):
        assert source.is_file() and source.stat().st_size > 0
print(json.dumps(report(LocalStorage(),{},Path(sys.argv[1]))))`;
    const payload = JSON.parse(execFileSync("python3", ["-c", code, process.env.REPLAY_PIPELINE_REPORT!, ids.analysisId, ids.jobId], {
      env: { ...process.env, PYTHONPATH: resolve("apps/video-worker/src") }, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024,
    })) as AnalysisPayload;
    expect(payload.candidates.length).toBeGreaterThan(0);
    const observed = payload.candidates.filter((candidate) => sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs));
    const rawProposalCount = payload.candidates.length - observed.length;
    expect(observed.length).toBeGreaterThan(0);
    for (const candidate of observed) {
      expect(sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)).toBe(true);
      expect(payload.evidence?.some((asset) => asset.candidateIndex === candidate.index && asset.kind === "CLIP")).toBe(true);
    }
    const response = await send(ids.jobId, payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "ACCEPTED" });
    const view = await readInternal(ids.sessionId, ids.analysisId);
    expect(view).not.toBeNull();
    if (!view) throw new Error("internal-analysis-not-returned");
    expect(view.filterSummary?.checkedCount).toBe(payload.candidates.length);
    expect(view.filterSummary?.excludedCount).toBe(0);
    expect(view.filterSummary?.observedCount).toBe(observed.length);
    expect(view.filterSummary?.applicableCount).toBe(0);
    expect(view.filterSummary?.undeterminedCount).toBe(rawProposalCount);
    expect(view).toMatchObject({
      judgmentStatus: "NOT_EVALUATED", rule: null,
      diagnostics: { rawProposalCount, invalidOutputCount: 0, recognizedEventCount: observed.length,
        supportedEventTypes: ["CORNER_KICK"],
        reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR", ...(rawProposalCount > 0 ? ["UNRECOGNIZED_PROPOSALS"] : [])]),
      },
    });
    const publicView = await readPublic(ids.sessionId, ids.analysisId);
    expectCompletedOnly(publicView);
    if (!publicView || "kind" in publicView) throw new Error("public-analysis-not-returned");
    expect(publicView.rule).toBeNull();
    expect(publicView.candidates.filter((candidate) => candidate.judgment != null)).toHaveLength(0);
    expect(await readInternal(ids.sessionId, ids.analysisId)).toEqual(view);
    const stored = await database.sql`select candidate_index, tracking, scene_event from incident_candidates where analysis_id = ${ids.analysisId}`;
    expect(stored).toHaveLength(payload.candidates.length);
    for (const input of payload.candidates) {
      const row = stored.find((item) => item.candidate_index === input.index);
      expect(row).toBeDefined();
      expect(row?.tracking).toEqual(input.tracking ?? null);
      expect(row?.scene_event).toEqual(input.sceneEvent ?? null);
    }
    expect(view.candidates).toHaveLength(observed.length);
    expect(view.candidates.map((candidate) => candidate.index).sort((a, b) => a - b)).toEqual(observed.map((candidate) => candidate.index).sort((a, b) => a - b));
    for (const candidate of view.candidates) {
      const input = payload.candidates.find((item) => item.index === candidate.index)!;
      expect(candidate.tracking).toEqual(input.tracking ?? null);
      expect(candidate.sceneEvent).toEqual(input.sceneEvent);
      expect(sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)).toBe(true);
      expect(candidate.filter?.status).not.toBe("EXCLUDED");
      expect(candidate.filter).toMatchObject({ status: "OBSERVED", situation: "CORNER_KICK", referenceOnly: true,
        ruleReferences: [], reasonCodes: expect.arrayContaining(["SITUATION_OBSERVED", "RULE_CONTEXT_UNVERIFIED"]),
      });
      expect(candidate.filter?.conditions?.length).toBeGreaterThan(0);
      expect(candidate.filter?.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(true);
      expect(candidate.evidence?.some((asset) => asset.kind === "CLIP")).toBe(true);
      expect(candidate.facts).toBeNull();
      expect(candidate.judgment).toBeNull();
    }
    if (process.env.REPLAY_RULES_OUTPUT) writeFileSync(process.env.REPLAY_RULES_OUTPUT, JSON.stringify(publicView, null, 2));
  });
});
