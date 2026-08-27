import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  SessionGrant,
  SessionIssue,
  SessionLookup,
  SessionRecord,
  SessionRepository,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type SessionRow = Readonly<{ id: string }>;

const token = (): string => randomBytes(32).toString("base64url");

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export class PostgresSessionRepository implements SessionRepository {
  public constructor(private readonly client: DatabaseHandle) {}

  public async issue(input: SessionIssue): Promise<SessionGrant> {
    const value = token();
    const rows = await this.client.db.execute(sql`
      insert into anonymous_sessions (token_hash, created_at, expires_at)
      values (${digest(value)}, ${input.createdAt}, ${input.expiresAt})
      returning id
    `);
    const [row] = rows as unknown as SessionRow[];

    if (!row) {
      throw new Error("Session insert did not return an id");
    }

    return { sessionId: row.id, token: value };
  }

  public async lookup(input: SessionLookup): Promise<SessionRecord | null> {
    const rows = await this.client.db.execute(sql`
      select id
      from anonymous_sessions
      where token_hash = ${Buffer.from(input.tokenHash)}
        and revoked_at is null
        and expires_at > ${input.now}
      limit 1
    `);
    const [row] = rows as unknown as SessionRow[];
    return row ? { sessionId: row.id } : null;
  }
}

export const sessionRepo = (client: DatabaseHandle): PostgresSessionRepository =>
  new PostgresSessionRepository(client);

export const createPostgresSessionRepository = sessionRepo;
