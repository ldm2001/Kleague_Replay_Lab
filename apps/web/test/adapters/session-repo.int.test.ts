import { createHash as digest } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { sessionRepo } from "@replay/adapters";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const createdAt = "2030-01-01T12:00:00.000Z";
const expiresAt = "2030-01-02T12:00:00.000Z";

describeDatabase("PostgreSQL session repository", () => {
  const database = databaseUrl ? client(databaseUrl) : null;
  if (!database) return;

  const repository = sessionRepo(database);
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await database.sql`select 1`;
  });

  afterEach(async () => {
    for (const sessionId of sessionIds.splice(0)) {
      await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
    }
  });

  afterAll(async () => {
    await database.close();
  });

  it("issues a random token and stores only its hash", async () => {
    const result = await repository.issue({ createdAt, expiresAt });
    sessionIds.push(result.sessionId);

    const [row] = await database.sql<{ token_hash: Buffer; expires_at: string }[]>`
      select token_hash, expires_at from anonymous_sessions where id = ${result.sessionId}
    `;

    expect(result.token.length).toBeGreaterThan(20);
    expect(row?.token_hash).not.toEqual(Buffer.from(result.token));
    expect(row?.token_hash).toHaveLength(32);
    expect(new Date(row!.expires_at).toISOString()).toBe(expiresAt);
  });

  it("looks up only active sessions by the token hash", async () => {
    const result = await repository.issue({ createdAt, expiresAt });
    sessionIds.push(result.sessionId);
    const tokenHash = Uint8Array.from(digest("sha256").update(result.token, "utf8").digest());

    await expect(repository.lookup({ tokenHash, now: createdAt })).resolves.toEqual({ sessionId: result.sessionId });

    await database.sql`update anonymous_sessions set revoked_at = ${createdAt} where id = ${result.sessionId}`;
    await expect(repository.lookup({ tokenHash, now: "2030-01-01T14:00:00.000Z" })).resolves.toBeNull();

    await database.sql`update anonymous_sessions set revoked_at = null, expires_at = '2030-01-01T13:00:00.000Z' where id = ${result.sessionId}`;
    await expect(repository.lookup({ tokenHash, now: "2030-01-01T14:00:00.000Z" })).resolves.toBeNull();
  });
});
