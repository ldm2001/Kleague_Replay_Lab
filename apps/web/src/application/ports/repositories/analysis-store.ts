// 분석 저장 명령
// 분석 제출 입력
export type AnalysisCommand = Readonly<{
  // 익명 세션 식별자
  anonymousSessionId: string;
  // 영상 자산 식별자
  videoAssetId: string;
  // 경기 식별자
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

// 분석 제출 결과
export type AnalysisResult =
  | Readonly<{ kind: "CREATED"; analysisId: string }>
  | Readonly<{ kind: "REPLAYED"; analysisId: string }>
  | Readonly<{ kind: "IDEMPOTENCY_KEY_REUSED" }>
  | Readonly<{ kind: "VIDEO_ASSET_UNAVAILABLE" }>
  | Readonly<{ kind: "VIDEO_ASSET_ALREADY_SUBMITTED" }>
  | Readonly<{ kind: "MATCH_UNAVAILABLE" }>
  | Readonly<{ kind: "RULE_VERSION_UNAVAILABLE" }>;

// 분석 저장 포트
export type AnalysisStore = Readonly<{
  submission: (command: AnalysisCommand) => Promise<AnalysisResult>;
}>;
