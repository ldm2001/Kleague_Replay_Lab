import { describe, expect, it } from "vitest";
import { createHash as digest } from "node:crypto";
import { s3, type S3ObjectClient } from "@replay/adapters";
import { S3Client } from "@aws-sdk/client-s3";

class TrackedBody implements AsyncIterable<Uint8Array> {
  destroyed = false;
  returned = false;
  exhausted = false;

  constructor(private readonly chunks: readonly Uint8Array[]) {}

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    let index = 0;
    return {
      next: async () => {
        if (index < this.chunks.length) return { done: false, value: this.chunks[index++]! };
        this.exhausted = true;
        return { done: true, value: undefined };
      },
      return: async () => {
        this.returned = true;
        return { done: true, value: undefined };
      },
    };
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeS3 implements S3ObjectClient {
  readonly commands: unknown[] = [];
  headResult: unknown = { ContentLength: 128, ChecksumSHA256: "AQID" };
  objectBody: Uint8Array[] = [Uint8Array.from([4, 5, 6])];
  bodyOverride?: TrackedBody;
  getContentLength?: number;

  async send(command: unknown) {
    this.commands.push(command);
    const name = command?.constructor?.name;
    if (name === "HeadObjectCommand") {
      return this.headResult;
    }
    if (name === "GetObjectCommand") {
      return {
        Body: this.bodyOverride ?? new TrackedBody(this.objectBody),
        ...(this.getContentLength === undefined ? {} : { ContentLength: this.getContentLength }),
      };
    }
    return {};
  }
}

describe("s3 upload storage", () => {
  it("grants a private put URL and returns the object head", async () => {
    const client = new FakeS3();
    const storage = s3({
      client,
      bucket: "replay-local",
      prefix: "uploads",
      sign: async () => "http://minio.test/upload-token",
    });

    const grant = await storage.grant({
      anonymousSessionId: "11111111-1111-4111-8111-111111111111",
      expectedSizeBytes: 128,
      contentType: "video/mp4",
      expiresAt: "2030-01-01T13:00:00.000Z",
    });
    const head = await storage.head(grant.objectKey);

    expect(grant).toMatchObject({
      uploadUrl: "http://minio.test/upload-token",
      expiresAt: "2030-01-01T13:00:00.000Z",
    });
    expect(grant.objectKey).toMatch(/^uploads\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.upload$/);
    expect(head).toEqual({ sizeBytes: 128, contentSha256: Uint8Array.from([1, 2, 3]) });
    expect(client.commands).toHaveLength(1);
    expect((client.commands[0] as any).input).toMatchObject({ ChecksumMode: "ENABLED" });
  });

  it("cleans up a staged object", async () => {
    const client = new FakeS3();
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await storage.cleanup("uploads/session/object.upload");

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]?.constructor?.name).toBe("DeleteObjectCommand");
  });

  it("grants a private read URL for a claimed worker job", async () => {
    const client = new FakeS3();
    const commands: string[] = [];
    const storage = s3({
      client,
      bucket: "replay-local",
      sign: async (_client, command) => {
        commands.push(command?.constructor?.name ?? "unknown");
        return "http://minio.test/read-token";
      },
    });

    await expect(storage.read("uploads/session/object.upload")).resolves.toBe("http://minio.test/read-token");
    expect(commands).toEqual(["GetObjectCommand"]);
  });

  it("grants a scoped evidence put URL", async () => {
    const client = new FakeS3();
    const commands: string[] = [];
    const storage = s3({
      client,
      bucket: "replay-local",
      sign: async (_client, command) => {
        commands.push(command?.constructor?.name ?? "unknown");
        return "http://minio.test/evidence-token";
      },
    });

    await expect(storage.evidence({
      analysisId: "22222222-2222-4222-8222-222222222222",
      jobId: "11111111-1111-4111-8111-111111111111",
      name: "candidate-0001.jpg",
      contentType: "image/jpeg",
      sizeBytes: 128,
    })).resolves.toEqual({
      objectKey: "evidence/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/candidate-0001.jpg",
      uploadUrl: "http://minio.test/evidence-token",
    });
    expect(commands).toEqual(["PutObjectCommand"]);
  });

  it("signs an immutable checksum-bound perception put", async () => {
    const client = new FakeS3();
    let signed: any;
    const storage = s3({
      client,
      bucket: "replay-local",
      sign: async (_client, command) => {
        signed = command;
        return "http://minio.test/perception-token";
      },
    });
    const sha256 = "a".repeat(64);

    await expect(storage.perception({
      analysisId: "22222222-2222-4222-8222-222222222222",
      jobId: "11111111-1111-4111-8111-111111111111",
      jobRevision: 2,
      contentSha256: sha256,
      sizeBytes: 1_024,
    })).resolves.toEqual({
      objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${sha256}.jsonl.gz`,
      uploadUrl: "http://minio.test/perception-token",
      headers: {
        "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
        "if-none-match": "*",
      },
    });
    expect(signed?.input).toMatchObject({
      Bucket: "replay-local",
      ContentType: "application/gzip",
      ContentLength: 1_024,
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      IfNoneMatch: "*",
    });
  });

  it("includes the checksum and conditional write headers in the AWS signature", async () => {
    const client = new S3Client({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
    });
    const sha256 = "a".repeat(64);
    try {
      const grant = await s3({ client, bucket: "replay-local" }).perception({
        analysisId: "22222222-2222-4222-8222-222222222222",
        jobId: "11111111-1111-4111-8111-111111111111",
        jobRevision: 2,
        contentSha256: sha256,
        sizeBytes: 1_024,
      });
      const signedHeaders = new URL(grant.uploadUrl).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
      expect(signedHeaders).toEqual(expect.arrayContaining(["if-none-match", "x-amz-checksum-sha256"]));
      expect(grant.headers).toEqual({
        "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
        "if-none-match": "*",
      });
    } finally {
      client.destroy();
    }
  });

  it("returns no head for a missing object and hashes a head without checksum", async () => {
    const client = new FakeS3();
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    client.headResult = Promise.reject(Object.assign(new Error("missing"), { name: "NotFound" }));
    await expect(storage.head("uploads/missing.upload")).resolves.toBeNull();

    client.headResult = { ContentLength: 3 };
    const expected = Uint8Array.from(digest("sha256").update(Buffer.from([4, 5, 6])).digest());
    await expect(storage.head("uploads/no-checksum.upload")).resolves.toEqual({ sizeBytes: 3, contentSha256: expected });
  });

  it("preserves a canonical short checksum for a legacy upload head", async () => {
    const client = new FakeS3();
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await expect(storage.head("uploads/legacy.upload")).resolves.toEqual({
      sizeBytes: 128,
      contentSha256: Uint8Array.from([1, 2, 3]),
    });
  });

  it("rejects malformed HEAD checksum metadata without downloading the object", async () => {
    const client = new FakeS3();
    client.headResult = { ContentLength: 3, ChecksumSHA256: "not-base64!" };
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await expect(storage.head("uploads/invalid-checksum.upload")).rejects.toThrow("checksum is invalid");
    expect(client.commands.map((command) => command?.constructor?.name)).toEqual(["HeadObjectCommand"]);
  });

  it.each([
    { name: "size growth", declared: 1, chunks: [new Uint8Array(10_240)], max: 1_024 },
    { name: "underflow", declared: 4, chunks: [Uint8Array.from([1, 2, 3])], max: 1_024 },
    { name: "mid-stream overflow", declared: 5, chunks: [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])], max: 1_024 },
  ])("bounds checksum fallback bytes for $name", async ({ declared, chunks, max }) => {
    const client = new FakeS3();
    const body = new TrackedBody(chunks);
    client.headResult = { ContentLength: declared };
    client.bodyOverride = body;
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await expect(storage.head("uploads/changing.upload", max)).rejects.toThrow(/length|limit|changed/);
    expect(body.destroyed || body.returned || body.exhausted).toBe(true);
  });

  it("rejects a GET content length that differs from HEAD and releases the body", async () => {
    const client = new FakeS3();
    const body = new TrackedBody([Uint8Array.from([1, 2, 3])]);
    client.headResult = { ContentLength: 3 };
    client.getContentLength = 4;
    client.bodyOverride = body;
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await expect(storage.head("uploads/changing.upload", 1_024)).rejects.toThrow("GET content length differs from HEAD");
    expect(body.destroyed || body.returned).toBe(true);
  });

  it("rejects an oversized checksum fallback before downloading its body", async () => {
    const client = new FakeS3();
    client.headResult = { ContentLength: 51 * 1_024 * 1_024 };
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    await expect(storage.head("perception/oversized.jsonl.gz", 50 * 1_024 * 1_024)).rejects.toThrow("exceeds the verification limit");
    expect(client.commands.map((command) => command?.constructor?.name)).toEqual(["HeadObjectCommand"]);
  });

  it("returns a private evidence body", async () => {
    const client = new FakeS3();
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    const object = await storage.body("evidence/analysis/job/candidate.jpg");
    const chunks: number[] = [];
    for await (const chunk of object.body) chunks.push(...chunk);

    expect(chunks).toEqual([4, 5, 6]);
    expect(client.commands[0]?.constructor?.name).toBe("GetObjectCommand");
  });
});
