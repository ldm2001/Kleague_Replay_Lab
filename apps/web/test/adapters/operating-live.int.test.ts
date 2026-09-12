import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { JobStore, S3Storage, Sha256, StatusStore } from "@replay/adapters";
import { client } from "@replay/database";
import { evidence, report, result, status, type AnalysisPayload } from "@replay/application";
import { perceptionRunData } from "@replay/shared-types";
import { evidence as evidenceRoute, result as resultRoute, type JobApiDependencies } from "../../src/apis/job";
import { knownVideoSource } from "../../src/adapters/known-video-sources";

const enabled = process.env.REPLAY_LOCAL_STORAGE_TEST === "1";
const reportPath = process.env.REPLAY_OPERATING_REPORT;
const sourcePath = process.env.REPLAY_OPERATING_SOURCE;
const databaseUrl = process.env.DATABASE_URL;

const localHost = (value: string): boolean => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname);
const environment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for an explicitly enabled local integration test`);
  return value;
};

function storage() {
  const endpoint = environment("STORAGE_ENDPOINT");
  if (!localHost(endpoint)) throw new Error("Live storage tests are restricted to loopback endpoints");
  const client = new S3Client({ endpoint, region: process.env.STORAGE_REGION ?? "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: environment("STORAGE_ACCESS_KEY_ID"), secretAccessKey: environment("STORAGE_SECRET_ACCESS_KEY") } });
  return { client, adapter: new S3Storage({ client, bucket: environment("STORAGE_BUCKET"), expiresInSeconds: 120 }) };
}

async function hashSource(path: string): Promise<Buffer> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest();
}

describe.skipIf(!enabled)("explicit local operating storage integration", () => {
  it("enforces signed checksum and conditional first-write semantics on real local storage", async () => {
    const { client, adapter } = storage();
    const analysisId = randomUUID(), jobId = randomUUID();
    const bytes = gzipSync(Buffer.from('{"kind":"HEADER","test":true}\n'));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const wrongDigest = "0".repeat(64);
    const expectedKeys = [digest, wrongDigest].map((sha) => `perception/${analysisId}/${jobId}/1/${sha}.jsonl.gz`);
    try {
      const grant = await adapter.perception({ analysisId, jobId, jobRevision: 1, contentSha256: digest, sizeBytes: bytes.length });
      expect(grant.objectKey).toBe(expectedKeys[0]);
      const options = { method: "PUT", headers: { ...grant.headers, "content-type": "application/gzip", "content-length": String(bytes.length) },
        body: Uint8Array.from(bytes).buffer };
      const accepted = await fetch(grant.uploadUrl, options);
      expect(accepted.status).toBe(200);
      await accepted.arrayBuffer();
      const repeated = await fetch(grant.uploadUrl, options);
      expect(repeated.status).toBe(412);
      await repeated.arrayBuffer();
      const actual = await adapter.head(grant.objectKey, 128 * 1024 * 1024);
      expect(actual?.sizeBytes).toBe(bytes.length);
      expect(Buffer.from(actual!.contentSha256).toString("hex")).toBe(digest);

      const bad = await adapter.perception({ analysisId, jobId, jobRevision: 1, contentSha256: wrongDigest, sizeBytes: bytes.length });
      expect(bad.objectKey).toBe(expectedKeys[1]);
      const rejected = await fetch(bad.uploadUrl, { ...options, headers: { ...options.headers, ...bad.headers } });
      expect(rejected.status).toBe(400);
      await rejected.arrayBuffer();
      expect(await adapter.head(bad.objectKey, 128 * 1024 * 1024)).toBeNull();
    } finally {
      // These are the two exact randomly scoped keys created by this test, never a prefix deletion.
      for (const key of expectedKeys) await adapter.cleanup(key);
      client.destroy();
    }
  }, 30_000);

  it.skipIf(!reportPath || !sourcePath || !databaseUrl)("submits the actual Python Worker report through real storage, API, DB and public rules filtering", async () => {
    if (!reportPath || !sourcePath || !databaseUrl) return;
    const name = new URL(databaseUrl).pathname.slice(1);
    if (!localHost(databaseUrl) || !/(?:^|_)test(?:_|$)/.test(name)) {
      throw new Error("Actual report integration requires an explicitly named local test database");
    }
    const local = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(local.pipeline_version).toBe("video-local-observers-v1");
    const sourceSha = await hashSource(sourcePath);
    expect(local.perception.sourceSha256).toBe(sourceSha.toString("hex"));
    const { client: storageClient, adapter: objectStorage } = storage();
    const database = client(databaseUrl);
    const sessionId = randomUUID(), videoId = randomUUID(), analysisId = randomUUID(), jobId = randomUUID();
    const leaseToken = randomBytes(24).toString("hex"), key = randomBytes(24).toString("hex");
    const started = new Date(), now = started.toISOString();
    const expires = new Date(started.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const leaseUntil = new Date(started.getTime() + 5 * 60 * 1000).toISOString();
    const hasher = new Sha256(), clock = { now: () => new Date() };
    const repository = new JobStore(database);
    const uploadedKeys = new Set<string>();
    const trackedStorage = {
      evidence: async (input: Parameters<S3Storage["evidence"]>[0]) => {
        const grant = await objectStorage.evidence(input);
        const expected = `evidence/${analysisId}/${jobId}/${input.name}`;
        if (grant.objectKey !== expected) throw new Error("Unexpected test evidence scope");
        uploadedKeys.add(expected);
        return grant;
      },
      perception: async (input: Parameters<S3Storage["perception"]>[0]) => {
        const grant = await objectStorage.perception(input);
        const expected = `perception/${analysisId}/${jobId}/1/${input.contentSha256}.jsonl.gz`;
        if (grant.objectKey !== expected) throw new Error("Unexpected test diagnostic scope");
        uploadedKeys.add(expected);
        return grant;
      },
    };
    const dependencies = { key,
      evidence: evidence({ clock, hasher, repository, storage: trackedStorage }),
      result: result({ clock, hasher, repository, storage: objectStorage }),
    } as JobApiDependencies;
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of incoming) {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) throw new Error("Test API request exceeds bound");
          chunks.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        const request = new Request(`http://127.0.0.1${incoming.url}`, { method: "POST", headers,
          body: Uint8Array.from(Buffer.concat(chunks)).buffer });
        const response = incoming.url === `/api/internal/jobs/${jobId}/evidence`
          ? await evidenceRoute(request, { jobId }, dependencies)
          : incoming.url === `/api/internal/jobs/${jobId}/result`
            ? await resultRoute(request, { jobId }, dependencies)
            : new Response(null, { status: 404 });
        outgoing.writeHead(response.status, { "content-type": "application/json" });
        outgoing.end(await response.text());
      } catch {
        outgoing.writeHead(500);
        outgoing.end('{"kind":"TEST_SERVER_ERROR"}');
      }
    });
    try {
      await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
        values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
      await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, rights_confirmed_at, created_at, expires_at, duration_ms, width, height)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${sourceSha}, 'video/mp4',
        ${statSync(sourcePath).size}, 'VALID', ${now}, ${now}, ${expires},
        ${local.video.duration_ms}, ${local.video.width}, ${local.video.height})`;
      // The hash is independently computed as upload completion would do. Do not manufacture IFAB adoption.
      await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
        source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${sourceSha},
        'video-local-observers-v1', 'media-v1', ${now}, ${expires})`;
      await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
        attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'live-test-worker',
        ${Buffer.from(await hasher.sha256(leaseToken))}, ${leaseUntil}, ${now}, ${now})`;
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test API address unavailable");
      const code = `import json,os,sys
from pathlib import Path
from replay_video.http import Api
from replay_video.runner import report
item=json.loads(os.environ['REPLAY_TEST_CLAIM'])
api=Api(os.environ['REPLAY_TEST_API'],os.environ['REPLAY_TEST_KEY'],'live-test-worker')
payload=report(api,item,Path(sys.argv[1]))
ack=api.result(item,payload)
print(json.dumps({'payload':payload,'ack':ack}))`;
      const stdout = await new Promise<string>((resolveOutput, reject) => {
        execFile(resolve("experiments/perception/.venv-referee/bin/python"), ["-c", code, reportPath], {
          env: { PATH: process.env.PATH, NODE_ENV: "test", PYTHONDONTWRITEBYTECODE: "1",
            PYTHONPATH: [resolve("apps/video-worker/src"), resolve("experiments/perception/src")].join(delimiter),
            REPLAY_TEST_API: `http://127.0.0.1:${address.port}`, REPLAY_TEST_KEY: key,
            REPLAY_TEST_CLAIM: JSON.stringify({ analysisId, jobId, jobRevision: 1, leaseToken }) },
          encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
        }, (error, stdout, stderr) => error ? reject(new Error(`Python report submission failed: ${stderr}`)) : resolveOutput(stdout));
      });
      const submitted = JSON.parse(stdout) as { payload: AnalysisPayload; ack: { kind: string } };
      expect(submitted.ack).toEqual({ kind: "ACCEPTED" });
      expect(perceptionRunData(submitted.payload.perception)).toBe(true);
      expect(submitted.payload.perception?.artifact.objectKey).toMatch(new RegExp(`^perception/${analysisId}/${jobId}/1/`));
      const [saved] = await database.sql<{ summary: Record<string, any>; artifact_object_key: string }[]>`
        select summary, artifact_object_key from analysis_perception_runs where analysis_id = ${analysisId}`;
      expect(saved?.summary.admission.status).toBe("NOT_ADMITTED");
      expect(saved?.summary.admission.reasons).toContain("RULE_EDITION_UNVERIFIED");
      expect(saved?.summary.coverage).toEqual(local.perception.coverage);
      expect(saved?.summary.incidents).toEqual(submitted.payload.perception?.incidents);
      const views = new StatusStore(database);
      const publicReport = await report({ clock, repository: views })({ anonymousSessionId: sessionId, analysisId });
      const publicStatus = await status({ clock, repository: views })({ anonymousSessionId: sessionId, videoAssetId: videoId });
      for (const view of [publicReport, publicStatus]) {
        expect(JSON.stringify(view)).not.toContain("perception/");
        expect(JSON.stringify(view)).not.toContain("sourceFilesSha256");
        expect(JSON.stringify(view)).not.toContain("roleHypotheses");
      }
      expect(publicReport).toMatchObject({ resultPolicy: "COMPLETED_ONLY", evaluatedCount: 0, judgmentStatus: "NOT_EVALUATED" });
      if (knownVideoSource(sourceSha.toString("hex")) && submitted.payload.candidates.some((candidate) => candidate.broadcastCue)) {
        expect((publicReport as any).completedScopeCount).toBeGreaterThan(0);
      }
      const [counts] = await database.sql<{ count: number }[]>`select count(*)::int as count
        from evidence_assets where analysis_id = ${analysisId} and object_key like 'perception/%'`;
      expect(counts?.count).toBe(0);
      if (process.env.REPLAY_OPERATING_VERIFICATION_OUT) {
        writeFileSync(process.env.REPLAY_OPERATING_VERIFICATION_OUT, JSON.stringify({
          sourceSha256: sourceSha.toString("hex"), pipelineVersion: submitted.payload.pipelineVersion,
          sourceHashIndependentlyVerified: true, storageAndApiResult: submitted.ack.kind,
          processingStatus: submitted.payload.perception?.processingStatus,
          coverage: submitted.payload.perception?.coverage, observationCounts: submitted.payload.perception?.summary,
          candidateCount: submitted.payload.candidates.length, evidenceCount: submitted.payload.evidence?.length,
          privateAdmission: saved?.summary.admission,
          publicResult: { status: (publicReport as any)?.status, resultPolicy: (publicReport as any)?.resultPolicy,
            completedScopeCount: (publicReport as any)?.completedScopeCount, evaluatedCount: (publicReport as any)?.evaluatedCount,
            judgmentStatus: (publicReport as any)?.judgmentStatus, candidateCount: (publicReport as any)?.candidates.length },
        }, null, 2), { flag: "wx" });
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.sql`delete from analysis_perception_runs where analysis_id = ${analysisId}`;
      await database.sql`delete from evidence_assets where analysis_id = ${analysisId}`;
      await database.sql`delete from incident_candidates where analysis_id = ${analysisId}`;
      await database.sql`delete from shots where analysis_id = ${analysisId}`;
      await database.sql`delete from processing_job_events where job_id = ${jobId}`;
      await database.sql`delete from processing_jobs where id = ${jobId}`;
      await database.sql`delete from analyses where id = ${analysisId}`;
      await database.sql`delete from video_assets where id = ${videoId}`;
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
      await database.close();
      for (const key of uploadedKeys) await objectStorage.cleanup(key);
      storageClient.destroy();
    }
  }, 180_000);
});
