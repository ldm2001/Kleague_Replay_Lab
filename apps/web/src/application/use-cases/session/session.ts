// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 비밀 토큰 생성 계약 가져옴
import type { Secret } from "../../ports/hashing/secret";
// 익명 세션의 소유권 확인 기능 가져옴
import type {
    SessionGrant,
    SessionRecord,
    SessionStore
} from "../../ports/repositories/session-store";

// 익명 세션 정책 정의
export type SessionPolicy = Readonly<{ ttlMs: number }>;

// 익명 세션 의존 기능 계약 정의
export type SessionDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 발급 토큰을 조회와 같은 방식으로 저장할 해시 계산 기능
    hasher: Hasher;
    // 크기와 보존 기간 등의 서비스 정책
    policy: SessionPolicy;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: SessionStore;
    // 세션 비밀 토큰 생성 기능
    secret: Secret;
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
    ({ clock, hasher, policy, repository, secret }: SessionDependencies) =>
    async (): Promise<SessionGrant> => {
        // 현재 시각 조회
        const now = clock.now();
        // 세션 비밀 토큰 생성
        const token = secret.token();
        // 원문 대신 토큰 해시와 만료 시각으로 세션 저장
        const record = await repository.issue({
            // 조회 시 같은 해시 계산으로 대조할 토큰 해시
            tokenHash: Uint8Array.from(await hasher.sha256(token)),
            // 기록이 처음 생성된 시각
            createdAt: now.toISOString(),
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: new Date(now.getTime() + policy.ttlMs).toISOString(),
        });
        // 원문 토큰은 저장소를 거치지 않고 발급 결과에만 연결
        return { ...record, token };
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
