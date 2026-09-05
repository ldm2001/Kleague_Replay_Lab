import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type { SessionStore, SessionRecord } from "../../ports/repositories/session-store";

export type SessionPolicy = Readonly<{ ttlMs: number }>;

export type SessionDependencies = Readonly<{
  clock: Clock;
  policy: SessionPolicy;
  repository: SessionStore;
}>;

export type RecordDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: SessionStore;
}>;

// 익명 세션 발급
export const session =
  ({ clock, policy, repository }: SessionDependencies) =>
  async () => {
    // 현재 시각 조회
    const now = clock.now();
    // 세션 만료 시각 계산
    return repository.issue({
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + policy.ttlMs).toISOString(),
    });
  };

// 익명 세션 기록 확인
export const record =
  ({ clock, hasher, repository }: RecordDependencies) =>
  async (token: string): Promise<SessionRecord | null> => {
    // 토큰 공백 제거
    const value = token.trim();
    // 빈 토큰 확인
    if (value.length === 0) {
      return null;
    }

    // 토큰 해시 생성
    const tokenHash = Uint8Array.from(await hasher.sha256(value));
    // 세션 조회
    return repository.lookup({ tokenHash, now: clock.now().toISOString() });
  };
