import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CompleteUploadCommand, CreateUploadCommand } from "@replay/application";
import { createDatabaseClient } from "@replay/database";
import { createPostgresUploadRepository } from "@replay/adapters";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const createdAt = "2030-01-01T12:00:00.000Z";
const uploadExpiresAt = "2030-01-01T13:00:00.000Z";
const sourceExpiresAt = "2030-01-01T14:00:00.000Z";

describeDatabase("PostgreSQL upload repository", () => {
  const client = databaseUrl ? createDatabaseClient(databaseUrl) : null;
  if (!client) return;

  const repository = createPostgresUploadRepository(client);
  const sessions: string[] = [];
  const intents: string[] = [];

  beforeAll(async () => {
    await client.sql`select 1`;
  });

  afterEach(async () => {
    for (const intentId of intents.splice(0)) {
      await client.sql`delete from processing_jobs where video_asset_id in (select id from video_assets where object_key in (select object_key from upload_intents where id = ${intentId}))`;
      await client.sql`delete from video_assets where object_key in (select object_key from upload_intents where id = ${intentId})`;
      await client.sql`delete from upload_intents where id = ${intentId}`;
    }
    for (const sessionId of sessions.splice(0)) {
      await client.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });

  afterAll(async () => {
    await client.close();
  });

  const seedSession = async (overrides: { expiresAt?: string; revokedAt?: string | null } = {}) => {
    const sessionId = randomUUID();
    sessions.push(sessionId);
    await client.sql`
      insert into anonymous_sessions (id, token_hash, created_at, expires_at, revoked_at)
      values (${sessionId}, ${Buffer.from(randomUUID())}, '2029-01-01T00:00:00.000Z', ${overrides.expiresAt ?? uploadExpiresAt}, ${overrides.revokedAt ?? null})
    `;
    return sessionId;
  };

  const commandFor = (sessionId: string, overrides: Partial<CreateUploadCommand> = {}): CreateUploadCommand => ({
    anonymousSessionId: sessionId,
    objectKey: `temporary/${randomUUID()}.mp4`,
    expectedSizeBytes: 100,
    declaredContentType: "video/mp4",
    rightsConfirmedAt: createdAt,
    expiresAt: uploadExpiresAt,
    mediaPolicyVersion: "media-v1",
    ...overrides,
  });

  const completeFor = (sessionId: string, intentId: string, objectKey: string, overrides: Partial<CompleteUploadCommand> = {}): CompleteUploadCommand => ({
    uploadIntentId: intentId,
    anonymousSessionId: sessionId,
    objectKey,
    sizeBytes: 100,
    contentSha256: Uint8Array.from([1, 2, 3]),
    contentType: "application/octet-stream",
    createdAt,
    expiresAt: sourceExpiresAt,
    mediaPolicyVersion: "media-v1",
    validationJobPayloadVersion: 1,
    validationMaxAttempts: 3,
    ...overrides,
  });

  it("persists an intent only for an active session", async () => {
    const sessionId = await seedSession();
    const command = commandFor(sessionId);

    const result = await repository.intent(command);

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") return;
    intents.push(result.uploadIntentId);

    const [row] = await client.sql<{
      anonymous_session_id: string;
      object_key: string;
      expected_size_bytes: string;
      declared_content_type: string;
      rights_confirmed_at: string;
      status: string;
      media_policy_version: string;
    }[]>`select * from upload_intents where id = ${result.uploadIntentId}`;
    expect(row).toMatchObject({
      anonymous_session_id: sessionId,
      object_key: command.objectKey,
      expected_size_bytes: "100",
      declared_content_type: "video/mp4",
      status: "CREATED",
      media_policy_version: "media-v1",
    });
    expect(new Date(row!.rights_confirmed_at).toISOString()).toBe(createdAt);
  });

  it("rejects expired or revoked sessions without writing an intent", async () => {
    for (const overrides of [{ expiresAt: "2030-01-01T11:59:59.000Z" }, { revokedAt: "2030-01-01T11:00:00.000Z" }]) {
      const sessionId = await seedSession(overrides);
      await expect(repository.intent(commandFor(sessionId))).resolves.toEqual({ kind: "SESSION_UNAVAILABLE" });
    }
  });

  it("completes an owned intent and queues validation atomically", async () => {
    const sessionId = await seedSession();
    const created = await repository.intent(commandFor(sessionId));
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    intents.push(created.uploadIntentId);
    const [intent] = await client.sql<{ object_key: string }[]>`select object_key from upload_intents where id = ${created.uploadIntentId}`;

    const result = await repository.complete(completeFor(sessionId, created.uploadIntentId, intent!.object_key));

    expect(result.kind).toBe("COMPLETED");
    if (result.kind !== "COMPLETED") return;
    const [asset] = await client.sql<{
      id: string;
      anonymous_session_id: string;
      object_key: string;
      content_sha256: Buffer;
      content_type: string;
      size_bytes: string;
      status: string;
      rights_confirmed_at: string;
      expires_at: string;
    }[]>`select * from video_assets where id = ${result.videoAssetId}`;
    const [job] = await client.sql<{
      job_type: string;
      status: string;
      payload_version: number;
      max_attempts: number;
    }[]>`select job_type, status, payload_version, max_attempts from processing_jobs where video_asset_id = ${result.videoAssetId}`;
    const [updatedIntent] = await client.sql<{ status: string; completed_at: string }[]>`select status, completed_at from upload_intents where id = ${created.uploadIntentId}`;

    expect(asset).toMatchObject({
      id: result.videoAssetId,
      anonymous_session_id: sessionId,
      object_key: intent!.object_key,
      content_type: "application/octet-stream",
      size_bytes: "100",
      status: "VALIDATING",
    });
    expect(asset?.content_sha256).toEqual(Buffer.from([1, 2, 3]));
    expect(new Date(asset!.rights_confirmed_at).toISOString()).toBe(createdAt);
    expect(new Date(asset!.expires_at).toISOString()).toBe(sourceExpiresAt);
    expect(job).toEqual({ job_type: "VALIDATE_VIDEO", status: "QUEUED", payload_version: 1, max_attempts: 3 });
    expect(updatedIntent?.status).toBe("COMPLETED");
    expect(new Date(updatedIntent!.completed_at).toISOString()).toBe(createdAt);
  });

  it("returns the active owned intent and hides another session's intent", async () => {
    const owner = await seedSession();
    const other = await seedSession();
    const created = await repository.intent(commandFor(owner));
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    intents.push(created.uploadIntentId);

    const [row] = await client.sql<{ object_key: string }[]>`select object_key from upload_intents where id = ${created.uploadIntentId}`;
    await expect(repository.owned({ anonymousSessionId: owner, uploadIntentId: created.uploadIntentId })).resolves.toMatchObject({
      uploadIntentId: created.uploadIntentId,
      anonymousSessionId: owner,
      objectKey: row!.object_key,
      expectedSizeBytes: 100,
    });
    await expect(repository.owned({ anonymousSessionId: other, uploadIntentId: created.uploadIntentId })).resolves.toBeNull();
  });

  it("rejects a completion command with a stale policy or size", async () => {
    const sessionId = await seedSession();
    const created = await repository.intent(commandFor(sessionId));
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    intents.push(created.uploadIntentId);
    const [intent] = await client.sql<{ object_key: string }[]>`select object_key from upload_intents where id = ${created.uploadIntentId}`;

    await expect(
      repository.complete(completeFor(sessionId, created.uploadIntentId, intent!.object_key, { mediaPolicyVersion: "media-v2" })),
    ).resolves.toEqual({ kind: "UPLOAD_INVALID" });
    await expect(
      repository.complete(completeFor(sessionId, created.uploadIntentId, intent!.object_key, { sizeBytes: 99 })),
    ).resolves.toEqual({ kind: "UPLOAD_INVALID" });
  });

  it("rolls back the asset and intent state when validation job creation fails", async () => {
    const sessionId = await seedSession();
    const created = await repository.intent(commandFor(sessionId));
    expect(created.kind).toBe("CREATED");
    if (created.kind !== "CREATED") return;
    intents.push(created.uploadIntentId);
    const [intent] = await client.sql<{ object_key: string }[]>`select object_key from upload_intents where id = ${created.uploadIntentId}`;

    await expect(repository.complete(completeFor(sessionId, created.uploadIntentId, intent!.object_key, { validationMaxAttempts: 0 }))).rejects.toThrow();
    const [intentAfter] = await client.sql<{ status: string }[]>`select status from upload_intents where id = ${created.uploadIntentId}`;
    const [assetCount] = await client.sql<{ count: string }[]>`select count(*)::text as count from video_assets where object_key = ${intent!.object_key}`;
    expect(intentAfter?.status).toBe("CREATED");
    expect(assetCount?.count).toBe("0");
  });
});
