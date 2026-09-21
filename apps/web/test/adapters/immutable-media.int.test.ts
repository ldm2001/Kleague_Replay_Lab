import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Storage } from "../../src/adapters/storage";

const enabled = process.env.REPLAY_IMMUTABLE_STORAGE_TEST === "1";

describe.skipIf(!enabled)("real Python HTTP + immutable local object storage", () => {
  it("allows first PUT, rejects overwrite and wrong bytes, and returns the verified checksum", async () => {
    const endpoint = process.env.STORAGE_ENDPOINT!;
    if (!["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname)) throw new Error("loopback-storage-required");
    const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    } });
    const bucket = `replay-auto-${randomUUID()}`;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const storage = new S3Storage({ client, bucket, expiresInSeconds: 120 });
    const root = await mkdtemp(join(tmpdir(), "replay-immutable-media-"));
    try {
      const body = Buffer.from("test media bytes");
      const source = join(root, "clip.mp4");
      await writeFile(source, body);
      const hash = createHash("sha256").update(body).digest("hex");
      const options = { analysisId: randomUUID(), jobId: randomUUID(), jobRevision: 2,
        name: "clip.mp4", contentType: "video/mp4" as const, sizeBytes: body.length, contentSha256: hash };
      const grant = await storage.evidence(options);
      const put = (value: typeof grant) => {
        const process = spawnSync("python3", ["-c", [
          "import json, sys", "from pathlib import Path", "from replay_video.http import Api, HttpError",
          "value = json.load(sys.stdin)", "try:",
          "    Api('http://unused', 'unused', 'test').put(value['url'], Path(value['path']), 'video/mp4', value['headers'])",
          "    print(json.dumps({'ok': True}))", "except HttpError as error:",
          "    print(json.dumps({'ok': False, 'error': str(error)}))",
        ].join("\n")], { cwd: resolve("apps/video-worker"), env: { ...globalThis.process.env, PYTHONPATH: "src" },
          input: JSON.stringify({ url: value.uploadUrl, path: source, headers: value.headers }), encoding: "utf8", timeout: 30_000 });
        expect(process.status, process.stderr).toBe(0);
        return JSON.parse(process.stdout);
      };
      expect(put(grant)).toEqual({ ok: true });
      expect(put(grant)).toEqual({ ok: false, error: "evidence-412" });
      expect(await storage.head(grant.objectKey)).toEqual({ sizeBytes: body.length, contentSha256: Uint8Array.from(Buffer.from(hash, "hex")) });
      const bad = await storage.evidence({ ...options, name: "bad.mp4" });
      await writeFile(source, Buffer.alloc(body.length, 42));
      expect(put(bad)).toEqual({ ok: false, error: "evidence-400" });
      expect(await storage.head(bad.objectKey)).toBeNull();
    } finally {
      client.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });
});
