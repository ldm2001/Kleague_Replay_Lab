// 분석 저장 명령
export type AnalysisCommand = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  matchId: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  keyHash: Uint8Array;
  requestHash: Uint8Array;
  createdAt: string;
  expiresAt: string;
  pipelineVersion: string;
  mediaPolicyVersion: string;
  jobPayloadVersion: number;
  maxJobAttempts: number;
}>;

export type AnalysisResult =
  | Readonly<{ kind: "CREATED"; analysisId: string }>
  | Readonly<{ kind: "REPLAYED"; analysisId: string }>
  | Readonly<{ kind: "IDEMPOTENCY_KEY_REUSED" }>
  | Readonly<{ kind: "VIDEO_ASSET_UNAVAILABLE" }>
  | Readonly<{ kind: "VIDEO_ASSET_ALREADY_SUBMITTED" }>
  | Readonly<{ kind: "MATCH_UNAVAILABLE" }>
  | Readonly<{ kind: "RULE_VERSION_UNAVAILABLE" }>;

export type AnalysisStore = Readonly<{
  submission: (command: AnalysisCommand) => Promise<AnalysisResult>;
}>;
