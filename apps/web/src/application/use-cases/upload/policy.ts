// 업로드 정책
export type UploadPolicy = Readonly<{
    // 파일 업로드의 최대 허용 바이트 크기
    maxBytes: number;
    // 업로드를 허용하는 콘텐츠 형식 목록
    allowedContentTypes: readonly string[];
    // 업로드 허가의 유효 기간 밀리초
    uploadIntentTtlMs: number;
    // 원본 영상의 보존 기간 밀리초
    sourceTtlMs: number;
    // 파일 보존과 허용 형식 정책의 버전
    mediaPolicyVersion: string;
    // 영상 검증 작업 입력 구조 버전
    validationJobPayloadVersion: number;
    // 영상 검증 작업의 최대 시도 횟수
    validationMaxAttempts: number;
}>;
