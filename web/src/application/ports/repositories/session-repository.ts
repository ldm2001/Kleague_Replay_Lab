export type SessionIssue = Readonly<{
  createdAt: string;
  expiresAt: string;
}>;

export type SessionLookup = Readonly<{
  tokenHash: Uint8Array;
  now: string;
}>;

export type SessionRecord = Readonly<{
  sessionId: string;
}>;

export type SessionGrant = Readonly<SessionRecord & {
  token: string;
}>;

export type SessionRepository = Readonly<{
  issue: (input: SessionIssue) => Promise<SessionGrant>;
  lookup: (input: SessionLookup) => Promise<SessionRecord | null>;
}>;
