// 세션 저장 명령
// 익명 세션 발급 입력
export type SessionIssue = Readonly<{
    // 기록이 처음 생성된 시각
    createdAt: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
}>;

// 세션 조회 입력
export type SessionLookup = Readonly<{
    // 원문 토큰 대신 비교에 사용하는 해시
    tokenHash: Uint8Array;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 세션 조회 모델
export type SessionRecord = Readonly<{
    // 소유권을 확인할 익명 세션 식별자
    sessionId: string;
}>;

// 세션 발급 결과
export type SessionGrant = Readonly<SessionRecord & {
    // 익명 세션 접근을 증명하는 비밀 값
    token: string;
}>;

// 세션 저장 포트
export type SessionStore = Readonly<{
    // 새 익명 세션 권한 발급 기능
    issue: (input: SessionIssue) => Promise<SessionGrant>;
    // 식별자나 토큰으로 기존 기록을 찾는 기능
    lookup: (input: SessionLookup) => Promise<SessionRecord | null>;
}>;
