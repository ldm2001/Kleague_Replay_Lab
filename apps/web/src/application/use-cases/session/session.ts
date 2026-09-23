// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 익명 세션의 소유권 확인 기능 가져옴
import type { SessionStore, SessionRecord } from "../../ports/repositories/session-store";

// 익명 세션 정책 정의
export type SessionPolicy = Readonly<{ ttlMs: number }>;

// 익명 세션 의존 기능 계약 정의
export type SessionDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 크기와 보존 기간 등의 서비스 정책
    policy: SessionPolicy;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: SessionStore;
}>;

// 기록 의존 기능 계약 정의
export type RecordDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
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
            // 기록이 처음 생성된 시각
            createdAt: now.toISOString(),
            // 접근과 보존을 허용하는 만료 시각
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
            // 사용할 세션 토큰이 없으면 세션 조회 생략 결과 반환
            return null;
        }

        // 토큰 해시 생성
        const tokenHash = Uint8Array.from(await hasher.sha256(value));
        // 세션 조회
        return repository.lookup({ tokenHash, now: clock.now().toISOString() });
    };
