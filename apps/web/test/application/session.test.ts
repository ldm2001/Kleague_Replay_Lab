// 세션 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
  record,
  session,
  type Clock,
  type Hasher,
  type SessionStore,
  type SessionPolicy,
} from "@replay/application";

const NOW = new Date("2030-01-01T12:00:00.000Z");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const clock: Clock = { now: () => NOW };
const policy: SessionPolicy = { ttlMs: 24 * 60 * 60 * 1000 };

// 세션 저장소 모형
class SessionStoreFake implements SessionStore {
  readonly issued: Array<Parameters<SessionStore["issue"]>[0]> = [];
  readonly lookups: Array<Parameters<SessionStore["lookup"]>[0]> = [];
  issuedResult = { sessionId: SESSION_ID, token: "session-token" };
  lookupResult: Awaited<ReturnType<SessionStore["lookup"]>> = { sessionId: SESSION_ID };

  async issue(input: Parameters<SessionStore["issue"]>[0]) {
    this.issued.push(input);
    return this.issuedResult;
  }

  async lookup(input: Parameters<SessionStore["lookup"]>[0]) {
    this.lookups.push(input);
    return this.lookupResult;
  }
}

class HashFake implements Hasher {
  readonly values: string[] = [];

  async sha256(value: string) {
    this.values.push(value);
    return Uint8Array.from([1, 2, 3]);
  }
}

describe("session", () => {
  it("issues a session with a bounded expiry", async () => {
    // 세션 발급 실행
    const repository = new SessionStoreFake();

    const result = await session({ clock, policy, repository })();

    expect(result).toEqual({ sessionId: SESSION_ID, token: "session-token" });
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
    const hasher = new HashFake();

    const result = await record({ clock, hasher, repository })("session-token");

    expect(result).toEqual({ sessionId: SESSION_ID });
    expect(hasher.values).toEqual(["session-token"]);
    expect(repository.lookups).toEqual([{
      tokenHash: Uint8Array.from([1, 2, 3]),
      now: "2030-01-01T12:00:00.000Z",
    }]);
  });

  it("does not call external ports for an empty token", async () => {
    // 빈 토큰 조회 실행
    const repository = new SessionStoreFake();
    const hasher = new HashFake();

    await expect(record({ clock, hasher, repository })("  ")).resolves.toBeNull();
    expect(hasher.values).toHaveLength(0);
    expect(repository.lookups).toHaveLength(0);
  });
});
