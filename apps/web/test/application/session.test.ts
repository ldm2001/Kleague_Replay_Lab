// 세션 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
    record,
    session,
    type Clock,
    type Hasher,
    type SessionStore,
    type SessionPolicy
} from "@replay/application";

// 현재시각 시험용 날짜 준비
const NOW = new Date("2030-01-01T12:00:00.000Z");
// 세션 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// 시계 시험 입력으로 현재시각 자료 생성
const clock: Clock = { now: () => NOW };
// 정책 시험 입력으로 시각 자료 생성
const policy: SessionPolicy = { ttlMs: 24 * 60 * 60 * 1000 };

// 세션 저장소 모형
class SessionStoreFake implements SessionStore {
    readonly issued: Array<Parameters<SessionStore["issue"]>[0]> = [];
    readonly lookups: Array<Parameters<SessionStore["lookup"]>[0]> = [];
    issuedResult = { sessionId: SESSION_ID, token: "session-token" };
    lookupResult: Awaited<ReturnType<SessionStore["lookup"]>> = { sessionId: SESSION_ID };

    // 검증용 발급 구성
    async issue(input: Parameters<SessionStore["issue"]>[0]) {
        // 입력 조건 추가 결과 처리 수행
        this.issued.push(input);
        // 입력 조건 결과 반환
        return this.issuedResult;
    }

    // 검증용 조회 구성
    async lookup(input: Parameters<SessionStore["lookup"]>[0]) {
        // 입력 조건 추가 결과 처리 수행
        this.lookups.push(input);
        // 입력 조건 결과 반환
        return this.lookupResult;
    }
}

class HashFake implements Hasher {
    readonly values: string[] = [];

    // 검증용 보안 해시 구성
    async sha256(value: string) {
        // 입력 조건 값목록 추가 결과 처리 수행
        this.values.push(value);
        // 바이트배열 변환 결과 반환
        return Uint8Array.from([1, 2, 3]);
    }
}

describe("session", () => {
    it("issues a session with a bounded expiry", async () => {
        // 세션 발급 실행
        const repository = new SessionStoreFake();

        // 세션 결과를 결과에 저장
        const result = await session({ clock, policy, repository })();

        // 결과의 세션 식별자 및 토큰 세션 토큰 자료 기준 구조 일치 확인
        expect(result).toEqual({ sessionId: SESSION_ID, token: "session-token" });
        // 저장소의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.issued).toEqual([{
            createdAt: "2030-01-01T12:00:00.000Z",
            expiresAt: "2030-01-02T12:00:00.000Z",
        }]);
    });
});

describe("record", () => {
    it("hashes a non-empty token and resolves its active session", async () => {
        // 세션 토큰 조회 실행
        const repository = new SessionStoreFake();
        // 해시계산기 시험용 해시 모의 준비
        const hasher = new HashFake();

        // 기록 결과를 결과에 저장
        const result = await record({ clock, hasher, repository })("session-token");

        // 결과의 세션 식별자 자료 기준 구조 일치 확인
        expect(result).toEqual({ sessionId: SESSION_ID });
        // 해시계산기 값목록의 1개 항목 목록 기준 구조 일치 확인
        expect(hasher.values).toEqual(["session-token"]);
        // 저장소의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.lookups).toEqual([{
            tokenHash: Uint8Array.from([1, 2, 3]),
            now: "2030-01-01T12:00:00.000Z",
        }]);
    });

    it("does not call external ports for an empty token", async () => {
        // 빈 토큰 조회 실행
        const repository = new SessionStoreFake();
        // 해시계산기 시험용 해시 모의 준비
        const hasher = new HashFake();

        // 기록 결과의 빈 값 확인
        await expect(record({ clock, hasher, repository })("  ")).resolves.toBeNull();
        // 해시계산기 값목록의 항목 수 0 확인
        expect(hasher.values).toHaveLength(0);
        // 저장소의 항목 수 0 확인
        expect(repository.lookups).toHaveLength(0);
    });
});
