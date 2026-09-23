// 세션 저장소 통합 테스트
import { createHash as digest } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { client } from "@replay/database";
import { sessionStore } from "@replay/adapters";

// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;
// 데이터베이스 시험용 입력 조건 준비
const describeDatabase = databaseUrl ? describe : describe.skip;
// 생성결과 시점 시험용 2030 01 00 00 준비
const createdAt = "2030-01-01T12:00:00.000Z";
// 만료시각 시점 시험용 2030 01 00 00 준비
const expiresAt = "2030-01-02T12:00:00.000Z";

// 데이터베이스 결과 처리 수행
describeDatabase("PostgreSQL session repository", () => {
    // 데이터베이스 시험용 입력 조건 준비
    const database = databaseUrl ? client(databaseUrl) : null;
    // 데이터베이스 부정 조건에 따른 처리 경로 분기
    if (!database) return;

    // 저장소 시험용 세션 저장소 결과 준비
    const repository = sessionStore(database);
    // 세션 식별자목록 시험용 0개 항목 목록 준비
    const sessionIds: string[] = [];

    beforeAll(async () => {
        // 시험 데이터베이스 자료 조회
        await database.sql`select 1`;
    });

    afterEach(async () => {
        // 세션 식별자목록 구간치환 결과의 각 사례 순회
        for (const sessionId of sessionIds.splice(0)) {
            // 익명 세션 삭제
            await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
        }
    });

    afterAll(async () => {
        // 데이터베이스 연결종료 결과 처리 수행
        await database.close();
    });

    it("issues a random token and stores only its hash", async () => {
        // 저장소 결과를 결과에 저장
        const result = await repository.issue({ createdAt, expiresAt });
        // 세션 식별자목록 추가 결과 처리 수행
        sessionIds.push(result.sessionId);

        // 익명 세션 조회
        const [row] = await database.sql<{ token_hash: Buffer; expires_at: string }[]>`
      select token_hash, expires_at from anonymous_sessions where id = ${result.sessionId}
    `;

        // 결과 토큰 길이의 20 초과 확인
        expect(result.token.length).toBeGreaterThan(20);
        // 행 토큰 해시의 바이트버퍼 변환 결과 기준 구조 불일치 확인
        expect(row?.token_hash).not.toEqual(Buffer.from(result.token));
        // 행 토큰 해시의 항목 수 32 확인
        expect(row?.token_hash).toHaveLength(32);
        // 날짜 표준시각문자열 결과의 기대값 만료시각 시점 일치 확인
        expect(new Date(row!.expires_at).toISOString()).toBe(expiresAt);
    });

    it("looks up only active sessions by the token hash", async () => {
        // 저장소 결과를 결과에 저장
        const result = await repository.issue({ createdAt, expiresAt });
        // 세션 식별자목록 추가 결과 처리 수행
        sessionIds.push(result.sessionId);
        // 토큰 해시 시험용 바이트배열 변환 결과 준비
        const tokenHash = Uint8Array.from(digest("sha256").update(result.token, "utf8").digest());

        // 저장소 결과의 세션 식별자 자료 기준 구조 일치 확인
        await expect(repository.lookup({ tokenHash, now: createdAt })).resolves.toEqual({
            sessionId: result.sessionId
        });

        // 익명 세션 갱신
        await database.sql`update anonymous_sessions set revoked_at = ${createdAt} where id = ${result.sessionId}`;
        // 저장소 결과의 빈 값 확인
        await expect(
            repository.lookup({ tokenHash, now: "2030-01-01T14:00:00.000Z" })
        ).resolves.toBeNull();

        // 익명 세션 갱신
        await database.sql`update anonymous_sessions set revoked_at = null, expires_at = '2030-01-01T13:00:00.000Z' where id = ${result.sessionId}`;
        // 저장소 결과의 빈 값 확인
        await expect(
            repository.lookup({ tokenHash, now: "2030-01-01T14:00:00.000Z" })
        ).resolves.toBeNull();
    });
});
