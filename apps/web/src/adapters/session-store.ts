// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    SessionIssue,
    SessionLookup,
    SessionRecord,
    SessionStore as SessionPort
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { activeSession } from "./visibility";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;

// 익명 세션 조회 행 정의
type SessionRow = Readonly<{ id: string }>;

// 세션 저장소 어댑터
export class SessionStore implements SessionPort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 원문 토큰 없이 해시로 익명 세션 저장
    public async issue(input: SessionIssue): Promise<SessionRecord> {
        // 세션 행 저장
        const rows = await this.client.db.execute(sql`
      insert into anonymous_sessions (token_hash, created_at, expires_at)
      values (${Buffer.from(input.tokenHash)}, ${input.createdAt}, ${input.expiresAt})
      returning id
    `);
        // 저장 행 선택
        const [row] = rows as unknown as SessionRow[];

        // 생성 식별자 확인
        if (!row) {
            // 새 세션 식별자가 없으면 생성 성공으로 처리하지 않고 오류 전달
            throw new Error("Session insert did not return an id");
        }

        // 저장한 세션 식별자 반환
        return { sessionId: row.id };
    }

    // 유효한 익명 세션 조회
    public async lookup(input: SessionLookup): Promise<SessionRecord | null> {
        // 세션 해시 조회
        const rows = await this.client.db.execute(sql`
      select session.id
      from anonymous_sessions as session
      where session.token_hash = ${Buffer.from(input.tokenHash)}
        and ${activeSession(input.now)}
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
