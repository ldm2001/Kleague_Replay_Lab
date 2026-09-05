// 세션 저장 명령
// 익명 세션 발급 입력
export type SessionIssue = Readonly<{
  createdAt: string;
  expiresAt: string;
}>;

// 세션 조회 입력
export type SessionLookup = Readonly<{
  tokenHash: Uint8Array;
  now: string;
}>;

// 세션 조회 모델
export type SessionRecord = Readonly<{
  sessionId: string;
}>;

// 세션 발급 결과
export type SessionGrant = Readonly<SessionRecord & {
  token: string;
}>;

// 세션 저장 포트
export type SessionStore = Readonly<{
  issue: (input: SessionIssue) => Promise<SessionGrant>;
  lookup: (input: SessionLookup) => Promise<SessionRecord | null>;
}>;
