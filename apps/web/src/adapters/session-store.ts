import { createHash as digest, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  SessionGrant,
  SessionIssue,
  SessionLookup,
  SessionRecord,
  SessionStore as SessionPort,
} from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type SessionRow = Readonly<{ id: string }>;

// 세션 토큰 생성
const token = (): string => randomBytes(32).toString("base64url");

// 세션 토큰 해시
const tokenHash = (value: string): Buffer => digest("sha256").update(value, "utf8").digest();

// 세션 저장소 어댑터
export class SessionStore implements SessionPort {
  public constructor(private readonly client: DatabaseHandle) {}

  public async issue(input: SessionIssue): Promise<SessionGrant> {
    // 세션 토큰 생성
    const value = token();
    // 세션 행 저장
    const rows = await this.client.db.execute(sql`
      insert into anonymous_sessions (token_hash, created_at, expires_at)
      values (${tokenHash(value)}, ${input.createdAt}, ${input.expiresAt})
      returning id
    `);
    // 저장 행 선택
    const [row] = rows as unknown as SessionRow[];

    // 생성 식별자 확인
    if (!row) {
      throw new Error("Session insert did not return an id");
    }

    // 세션 발급 결과 반환
    return { sessionId: row.id, token: value };
  }

  public async lookup(input: SessionLookup): Promise<SessionRecord | null> {
    // 세션 해시 조회
    const rows = await this.client.db.execute(sql`
      select id
      from anonymous_sessions
      where token_hash = ${Buffer.from(input.tokenHash)}
        and revoked_at is null
        and expires_at > ${input.now}
      limit 1
    `);
    // 조회 행 선택
    const [row] = rows as unknown as SessionRow[];
    // 세션 조회 결과 반환
    return row ? { sessionId: row.id } : null;
  }
}

// 세션 저장소 생성
export const sessionStore = (client: DatabaseHandle): SessionStore =>
  new SessionStore(client);
