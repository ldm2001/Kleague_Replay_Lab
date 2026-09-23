// 업로드 저장 포트
// 업로드 권한 모델
export type UploadGrant = Readonly<{
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일을 직접 전송할 기한부 서명 주소
    uploadUrl: string;
    // 접근과 보존을 허용하는 만료 시각
    expiresAt: string;
}>;

// 업로드 저장소 포트
export type UploadStorage = Readonly<{
    // 기한이 있는 업로드 권한 발급 기능
    grant: (input: Readonly<{
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: string;
        // 업로드 전에 신고한 파일 바이트 크기
        expectedSizeBytes: number;
        // 파일의 실제 또는 허용 콘텐츠 형식
        contentType: string;
        // 접근과 보존을 허용하는 만료 시각
        expiresAt: string;
    }>) => Promise<UploadGrant>;
    // 실패한 업로드의 저장 파일 정리 기능
    cleanup: (objectKey: string) => Promise<void>;
}>;

// 저장 객체 메타데이터
export type UploadedObjectHead = Readonly<{
    // 파일의 바이트 크기
    sizeBytes: number;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: Uint8Array;
}>;

// 업로드 완료 저장소 포트
export type CompletionStorage = Readonly<{
    // 저장 파일의 존재와 크기 및 해시 조회 기능
    head: (objectKey: string, maxSizeBytes?: number) => Promise<UploadedObjectHead | null>;
}>;

// 작업자 원본 읽기 포트
export type JobSourceStorage = Readonly<{
    // 저장 파일 본문 읽기 기능
    read: (objectKey: string) => Promise<string>;
}>;
