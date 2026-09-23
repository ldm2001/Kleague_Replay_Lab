// 분석 저장 명령
// 분석 제출 입력
export type AnalysisCommand = Readonly<{
    // 익명 세션 식별자
    anonymousSessionId: string;
    // 영상 자산 식별자
    videoAssetId: string;
    // 경기 식별자
    matchId: string;
    // 원본 영상의 출처 주소
    sourceUrl: string | null;
    // 원본 영상을 제공한 플랫폼
    sourcePlatform: string | null;
    // 멱등 요청 키의 해시
    keyHash: Uint8Array;
    // 동일 키로 다른 요청을 보냈는지 확인하는 해시
    requestHash: Uint8Array;
    // 기록이 처음 생성된 시각
    createdAt: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
    // 영상 처리 절차를 구별하는 버전
    pipelineVersion: string;
    // 파일 보존과 허용 형식 정책의 버전
    mediaPolicyVersion: string;
    // 분석 작업 입력 구조 버전
    jobPayloadVersion: number;
    // 분석 작업의 최대 실행 시도 횟수
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
    // 영상 분석 요청을 저장하는 기능
    submission: (command: AnalysisCommand) => Promise<AnalysisResult>;
}>;
