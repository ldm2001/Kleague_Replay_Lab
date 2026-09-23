// 증거 업로드 권한 입력
export type EvidenceGrantInput = Readonly<{
    // 분석 기록의 식별자
    analysisId: string;
    // 처리 작업의 식별자
    jobId: string;
    // 저장소 요청에서 사용하는 파일 이름
    name: string;
    // 파일의 실제 또는 허용 콘텐츠 형식
    contentType: "image/jpeg" | "video/mp4";
    // 파일의 바이트 크기
    sizeBytes: number;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision?: number;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256?: string;
}>;

// 증거 업로드 권한 모델
export type EvidenceGrant = Readonly<{
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일을 직접 전송할 기한부 서명 주소
    uploadUrl: string;
    // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
    headers?: Readonly<Record<string, string>>;
}>;

// 비공개 관측 원문 업로드 권한 요청 정의
export type PerceptionGrantInput = Readonly<{
    // 분석 기록의 식별자
    analysisId: string;
    // 처리 작업의 식별자
    jobId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: string;
    // 파일의 바이트 크기
    sizeBytes: number;
}>;

// 증거 저장소 포트
export type EvidenceStorage = Readonly<{
    // 원본에 연결한 증거 자료 또는 접근 기능
    evidence: (input: EvidenceGrantInput) => Promise<EvidenceGrant>;
    // 사실 채택과 구분한 모델 관측 처리 자료
    perception?: (input: PerceptionGrantInput) => Promise<EvidenceGrant>;
}>;

// 증거 저장 포트
// 증거 본문 모델
export type EvidenceBody = Readonly<{
    // 응답하거나 저장소에서 읽는 자료 본문
    body: AsyncIterable<Uint8Array>;
}>;

// 증거 본문 저장소 포트
export type EvidenceBodyStorage = Readonly<{
    // 응답하거나 저장소에서 읽는 자료 본문
    body: (objectKey: string) => Promise<EvidenceBody>;
}>;
