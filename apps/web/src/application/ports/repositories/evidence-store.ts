// 증거 접근 명령
// 증거 접근 입력
export type EvidenceAccessCommand = Readonly<{
    // 작업 식별자
    jobId: string;
    // 작업자 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 작업 임대 권한 비교용 토큰 해시
    leaseTokenHash: Uint8Array;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 증거 접근 결과
export type EvidenceAccess =
    | Readonly<{ kind: "AUTHORIZED"; analysisId: string }>
    | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED" }>;

// 증거 저장 포트
export type EvidenceStore = Readonly<{
    // 현재 임대에 따른 증거 접근 권한 확인 기능
    access: (command: EvidenceAccessCommand) => Promise<EvidenceAccess>;
}>;
