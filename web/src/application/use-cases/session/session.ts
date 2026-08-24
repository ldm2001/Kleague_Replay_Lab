import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type { SessionRepository, SessionRecord } from "../../ports/repositories/session-repository";

export type SessionPolicy = Readonly<{ ttlMs: number }>;

export type SessionDependencies = Readonly<{
  clock: Clock;
  policy: SessionPolicy;
  repository: SessionRepository;
}>;

export type ResolveDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: SessionRepository;
}>;

export const session =
  ({ clock, policy, repository }: SessionDependencies) =>
  async () => {
    const now = clock.now();
    return repository.issue({
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + policy.ttlMs).toISOString(),
    });
  };

export const resolve =
  ({ clock, hasher, repository }: ResolveDependencies) =>
  async (token: string): Promise<SessionRecord | null> => {
    const value = token.trim();
    if (value.length === 0) {
      return null;
    }

    const tokenHash = Uint8Array.from(await hasher.sha256(value));
    return repository.lookup({ tokenHash, now: clock.now().toISOString() });
  };
