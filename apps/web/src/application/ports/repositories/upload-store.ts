// 업로드 저장 명령
// 업로드 의도 입력
export type UploadCommand = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 업로드 전에 신고한 파일 바이트 크기
    expectedSizeBytes: number;
    // 업로드 전에 신고한 콘텐츠 형식
    declaredContentType: string;
    // 규정 적용 대상 대회
    competition?: string;
    // 규정 적용 대상 시즌
    season?: string;
    // 영상 사용 권리를 확인한 시각
    rightsConfirmedAt: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
    // 파일 보존과 허용 형식 정책의 버전
    mediaPolicyVersion: string;
}>;

// 업로드 결과 정의
export type UploadIntentResult =
    | Readonly<{ kind: "CREATED"; uploadIntentId: string }>
    | Readonly<{ kind: "SESSION_UNAVAILABLE" }>;

// 업로드 의도 저장 포트
export type UploadIntentStore = Readonly<{
    // 업로드 허가 기록을 만드는 기능
    intent: (command: UploadCommand) => Promise<UploadIntentResult>;
}>;

// 업로드 의도 조회 모델
export type UploadIntentRecord = Readonly<{
    // 업로드 허가 기록의 식별자
    uploadIntentId: string;
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 업로드 전에 신고한 파일 바이트 크기
    expectedSizeBytes: number;
    // 업로드 전에 신고한 콘텐츠 형식
    declaredContentType: string;
    // 규정 적용 대상 대회
    competition: string;
    // 규정 적용 대상 시즌
    season: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
}>;

// 업로드 완료 저장 입력
export type CompletionCommand = Readonly<{
    // 업로드 허가 기록의 식별자
    uploadIntentId: string;
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일의 바이트 크기
    sizeBytes: number;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: Uint8Array;
    // 파일의 실제 또는 허용 콘텐츠 형식
    contentType: string;
    // 기록이 처음 생성된 시각
    createdAt: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
    // 파일 보존과 허용 형식 정책의 버전
    mediaPolicyVersion: string;
    // 영상 검증 작업 입력 구조 버전
    validationJobPayloadVersion: number;
    // 영상 검증 작업의 최대 시도 횟수
    validationMaxAttempts: number;
}>;

// 업로드 완료 결과
export type UploadCompletionResult =
    | Readonly<{ kind: "COMPLETED"; videoAssetId: string }>
    | Readonly<{ kind: "UPLOAD_ALREADY_COMPLETED" }>
    | Readonly<{ kind: "UPLOAD_NOT_FOUND" }>
    | Readonly<{ kind: "UPLOAD_NOT_READY" }>
    | Readonly<{ kind: "UPLOAD_INVALID" }>;

// 업로드 완료 저장 포트
export type UploadCompletionStore = Readonly<{
    // 세션 소유의 업로드 기록을 찾는 기능
    owned: (input: Readonly<{
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: string;
        // 업로드 허가 기록의 식별자
        uploadIntentId: string;
    }>) => Promise<UploadIntentRecord | null>;
    // 업로드 완료와 후속 영상 검증 연결
    complete: (command: CompletionCommand) => Promise<UploadCompletionResult>;
}>;
