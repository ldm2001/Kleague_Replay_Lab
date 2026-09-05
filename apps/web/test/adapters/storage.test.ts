import { describe, expect, it } from "vitest";
import { createHash as digest } from "node:crypto";
import { s3, type S3ObjectClient } from "@replay/adapters";

class FakeS3 implements S3ObjectClient {
  readonly commands: unknown[] = [];
  headResult: unknown = { ContentLength: 128, ChecksumSHA256: "AQID" };
  objectBody: Uint8Array[] = [Uint8Array.from([4, 5, 6])];

  async send(command: unknown) {
    this.commands.push(command);
    const name = command?.constructor?.name;
    if (name === "HeadObjectCommand") {
      return this.headResult;
    }
    if (name === "GetObjectCommand") {
      return {
        Body: {
          async *[Symbol.asyncIterator]() {
            yield* this.body;
          },
          body: this.objectBody,
        },
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

  it("returns no head for a missing object and hashes a head without checksum", async () => {
    const client = new FakeS3();
    const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

    client.headResult = Promise.reject(Object.assign(new Error("missing"), { name: "NotFound" }));
    await expect(storage.head("uploads/missing.upload")).resolves.toBeNull();

    client.headResult = { ContentLength: 128 };
    const expected = Uint8Array.from(digest("sha256").update(Buffer.from([4, 5, 6])).digest());
    await expect(storage.head("uploads/no-checksum.upload")).resolves.toEqual({ sizeBytes: 128, contentSha256: expected });
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
