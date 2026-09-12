import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { JobStore, StatusStore } from "@replay/adapters";
import { client } from "@replay/database";
import { report, status, type AnalysisPayload } from "@replay/application";
import { perceptionAdmission } from "@replay/rule-engine";
import { perceptionRunData } from "@replay/shared-types";

const databaseUrl = process.env.DATABASE_URL;
const NOW = "2030-01-01T12:00:00.000Z";
const EXPIRES = "2030-01-02T12:00:00.000Z";

describe.skipIf(!databaseUrl)("private perception result flow", () => {
  if (!databaseUrl) return;
  const database = client(databaseUrl);
  const sessions: string[] = [];

  afterEach(async () => {
    for (const sessionId of sessions.splice(0)) {
      const analyses = await database.sql<{ id: string }[]>`select id from analyses where anonymous_session_id = ${sessionId}`;
      for (const row of analyses) {
        await database.sql`delete from analysis_perception_runs where analysis_id = ${row.id}`;
        await database.sql`delete from evidence_assets where analysis_id = ${row.id}`;
        await database.sql`delete from incident_candidates where analysis_id = ${row.id}`;
        await database.sql`delete from shots where analysis_id = ${row.id}`;
        await database.sql`delete from processing_job_events where job_id in (select id from processing_jobs where analysis_id = ${row.id})`;
        await database.sql`delete from processing_jobs where analysis_id = ${row.id}`;
        await database.sql`delete from analyses where id = ${row.id}`;
      }
      await database.sql`delete from video_assets where anonymous_session_id = ${sessionId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });
  afterAll(async () => { await database.close(); });

  it("persists one immutable private run without exposing it as media or an evaluation", async () => {
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    const source = randomBytes(32), sourceHex = source.toString("hex");
    const artifactSha = "b".repeat(64), evidenceSha = "c".repeat(64);
    const lease = Uint8Array.from(randomBytes(32));
    sessions.push(sessionId);
    await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
      values (${sessionId}, ${randomBytes(32)}, ${NOW}, ${EXPIRES})`;
    await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
      size_bytes, status, rights_confirmed_at, created_at, expires_at)
      values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${source}, 'video/mp4', 100, 'VALID', ${NOW}, ${NOW}, ${EXPIRES})`;
    await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
      source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
      values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${source},
      'video-local-observers-v1', 'media-v1', ${NOW}, ${EXPIRES})`;
    await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
      attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
      values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 2, 1, 3, 'worker-1', ${Buffer.from(lease)},
      ${EXPIRES}, ${NOW}, ${NOW})`;

    const payload: AnalysisPayload = {
      kind: "ANALYZED", pipelineVersion: "video-local-observers-v1", limitations: [],
      shots: [{ index: 0, startMs: 0, endMs: 2_000, playbackSpeed: "NORMAL", isReplay: false, cameraAngle: null }],
      candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1_500, anchorMs: 1_000,
        confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [0] }],
      evidence: [{ candidateIndex: 1, kind: "FRAME", objectKey: `evidence/${analysisId}/${jobId}/frame.jpg`,
        contentSha256: evidenceSha, startMs: 1_000, endMs: 1_000, width: 1_920, height: 1_080 }],
      perception: {
        schemaVersion: "perception-run-v1", sourceSha256: sourceHex, processingStatus: "COMPLETE",
        coverage: { startMs: 0, endMs: 2_000, sampleIntervalMs: 500, expectedSamples: 4, processedSamples: 4, failedSamples: 0 },
        models: [
          { component: "detector", modelId: "PekingU/rtdetr_r18vd", revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753", weightsSha256: "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093" },
          { component: "role", modelId: "martinjolif/yolo-football-player-detection", revision: "5e83fafa8d564243001ce8e063612a618a138fbe", weightsSha256: "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd" },
          { component: "pose", modelId: "usyd-community/vitpose-plus-small", revision: "0c30b6534bb621af0162b481176742577264e36e", weightsSha256: "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9" },
        ],
        artifact: { objectKey: `perception/${analysisId}/${jobId}/2/${artifactSha}.jsonl.gz`, contentType: "application/gzip",
          contentSha256: artifactSha, sizeBytes: 1_024 },
        summary: { roleObservationCount: 1, poseObservationCount: 1, officialCueCount: 0,
          interactionCount: 1, linkCount: 1, truncated: false, reasons: [] },
        incidents: [{ id: "incident-1", candidateIndex: 1, continuityId: 1, startMs: 600, endMs: 1_400,
          evidenceIndices: [0], officialRole: "UNKNOWN", signal: "UNKNOWN", contact: "UNVERIFIED",
          originalDecision: "UNKNOWN", restart: "UNVERIFIED", reasons: ["method-not-verified"] }],
      },
    };
    const boundary = payload as any;
    boundary.perception.incidents = Array.from({ length: 128 }, (_, index) => ({
      id: `incident-${index}-`.padEnd(128, "x"), candidateIndex: 1, continuityId: index,
      startMs: 600, endMs: 1_400, evidenceIndices: [0], officialRole: "UNKNOWN", signal: "UNKNOWN",
      contact: "UNVERIFIED", originalDecision: "UNKNOWN", restart: "UNVERIFIED",
      reasons: Array.from({ length: 11 }, (__, reason) => `${index}-${reason}-`.padEnd(128, "r")),
    }));
    boundary.perception.summary = { roleObservationCount: 5_000, poseObservationCount: 5_000,
      officialCueCount: 128, interactionCount: 4_000, linkCount: 0, truncated: true, reasons: [] };
    expect(perceptionRunData(payload.perception)).toBe(true);
    const admission = perceptionAdmission(payload.perception!, {
      serverVerified: true, pipelineVersion: payload.pipelineVersion, sourceSha256: sourceHex,
      artifact: { objectKey: payload.perception!.artifact.objectKey, contentSha256: artifactSha, sizeBytes: 1_024 },
      references: [{ evidenceIndex: 0, candidateIndex: 1, startMs: 1_000, endMs: 1_000,
        declaredContentSha256: evidenceSha, verifiedContentSha256: evidenceSha }],
      ruleEdition: null,
    });
    const privateEnvelope = { ...payload.perception!.summary, processingStatus: payload.perception!.processingStatus,
      coverage: payload.perception!.coverage, incidents: payload.perception!.incidents, admission };
    expect(Buffer.byteLength(JSON.stringify(payload.perception), "utf8")).toBeLessThanOrEqual(256 * 1_024);
    expect(Buffer.byteLength(JSON.stringify(privateEnvelope), "utf8")).toBeGreaterThan(256 * 1_024);
    expect(Buffer.byteLength(JSON.stringify(privateEnvelope), "utf8")).toBeLessThanOrEqual(1_048_576);

    const repository = new JobStore(database, () => new Date(NOW));
    await expect(repository.preflight({
      jobId, workerId: "worker-1", jobRevision: 2, leaseTokenHash: lease, now: NOW,
    })).resolves.toMatchObject({ kind: "AUTHORIZED", ruleEdition: null });
    await expect(repository.result({
      jobId, workerId: "worker-1", jobRevision: 2, leaseTokenHash: lease, now: NOW, payload,
      perceptionVerification: { analysisId, sourceSha256: source, admission },
    })).resolves.toEqual({ kind: "ACCEPTED" });

    const [stored] = await database.sql<{ artifact_object_key: string; summary: Record<string, unknown>; expires_at: string }[]>`
      select artifact_object_key, summary, expires_at from analysis_perception_runs where analysis_id = ${analysisId}`;
    expect(stored?.artifact_object_key).toBe(payload.perception!.artifact.objectKey);
    expect(stored?.summary).toMatchObject({ admission: { status: "NOT_ADMITTED" }, incidents: payload.perception!.incidents });
    expect(new Date(stored!.expires_at).toISOString()).toBe(EXPIRES);
    expect(await database.sql`select id from evidence_assets where object_key like 'perception/%'`).toHaveLength(0);
    await expect(database.sql`update analysis_perception_runs set artifact_size_bytes = 0 where analysis_id = ${analysisId}`).rejects.toThrow();
    await expect(database.sql`update analysis_perception_runs set source_sha256 = ${Buffer.from([1])} where analysis_id = ${analysisId}`).rejects.toThrow();
    await expect(database.sql`update analysis_perception_runs set summary = '[]'::jsonb where analysis_id = ${analysisId}`).rejects.toThrow();
    await expect(database.sql`update analysis_perception_runs set summary = jsonb_build_object(
      'incidents', '[]'::jsonb, 'admission', jsonb_build_object('padding', repeat('x', 1048576))
    ) where analysis_id = ${analysisId}`).rejects.toThrow();

    const adapter = new StatusStore(database);
    const internal = await adapter.analysis({ anonymousSessionId: sessionId, analysisId, now: NOW });
    expect(JSON.stringify(internal)).not.toContain("artifactObjectKey");
    expect(JSON.stringify(internal)).not.toContain("CONTACT_METHOD_NOT_VERIFIED");
    expect(internal).toMatchObject({ judgmentStatus: "NOT_EVALUATED", evaluatedCount: 0 });
    const media = await status({ clock: { now: () => new Date(NOW) }, repository: adapter })({
      anonymousSessionId: sessionId, videoAssetId: videoId,
    });
    const publicReport = await report({ clock: { now: () => new Date(NOW) }, repository: adapter })({
      anonymousSessionId: sessionId, analysisId,
    });
    for (const view of [media, publicReport]) {
      expect(JSON.stringify(view)).not.toContain("artifactObjectKey");
      expect(JSON.stringify(view)).not.toContain("CONTACT_METHOD_NOT_VERIFIED");
      expect(JSON.stringify(view)).not.toContain("perception/");
    }
  });
});
