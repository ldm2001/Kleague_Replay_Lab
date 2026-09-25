// 작업 저장 명령과 결과
export type JobType =
    | "VALIDATE_VIDEO"
    | "ANALYZE_VIDEO"
    | "DELETE_VIDEO_ASSET"
    | "PURGE_ANALYSIS";

// 작업 처리 단계
export type JobStage =
    | "QUEUED"
    | "VALIDATING"
    | "SEGMENTING"
    | "DETECTING"
    | "EXTRACTING_FACTS"
    | "BUILDING_EVIDENCE"
    | "APPLYING_RULES"
    | "SUCCEEDED"
    | "FAILED";

// 작업 선점 입력
export type JobClaimCommand = Readonly<{
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 영상 검증과 분석의 작업 구분
    jobType: JobType;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
    // 현재 작업 임대의 유효 기한
    leaseUntil: string;
}>;

// 작업 선점 결과
export type JobClaim = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 영상 검증과 분석의 작업 구분
    jobType: JobType;
    // 작업 입력 자료 구조의 버전
    payloadVersion: number;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 현재 작업 실행 시도 횟수
    attempt: number;
    // 현재 영상 처리 단계
    stage: JobStage;
    // 작업 진행률의 백분율
    progressPercent: number;
    // 현재 작업 임대를 증명하는 비밀 토큰
    leaseToken: string;
    // 현재 작업 임대의 유효 기한
    leaseUntil: string;
    // 분석 기록의 식별자
    analysisId: string | null;
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: string | null;
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string | null;
    // 원본 영상의 출처 주소
    sourceUrl?: string;
}>;

// 작업 선점 저장 포트
export type JobStore = Readonly<{
    // 작업 선점과 원본 접근 권한 발급
    claim: (command: JobClaimCommand) => Promise<JobClaim | null>;
}>;

// 작업 진행 입력
export type JobProgressCommand = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 작업 임대 권한 비교용 토큰 해시
    leaseTokenHash: Uint8Array;
    // 현재 영상 처리 단계
    stage: JobStage;
    // 작업 진행률의 백분율
    progressPercent: number;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
    // 현재 작업 임대의 유효 기한
    leaseUntil: string;
    // 처리 진행 또는 실패의 안내 문구
    message: string | null;
}>;

// 작업 진행 결과
export type JobProgress =
    | Readonly<{
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "UPDATED";
            // 현재 영상 처리 단계
            stage: JobStage;
            // 작업 진행률의 백분율
            progressPercent: number;
            // 작업자가 마지막으로 생존을 알린 시각
            heartbeatAt: string;
            // 현재 작업 임대의 유효 기한
            leaseUntil: string;
        }>
    | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" }>;

// 작업 진행 저장 포트
export type JobProgressStore = Readonly<{
    // 현재 작업 임대의 진행 상태 갱신
    progress: (command: JobProgressCommand) => Promise<JobProgress>;
}>;

// 영상 검증 결과 입력
export type ValidationPayload = Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "VALIDATED";
    // 영상 전체 길이의 밀리초 값
    durationMs: number;
    // 영상 또는 증거 이미지의 가로 크기
    width: number;
    // 영상 또는 증거 이미지의 세로 크기
    height: number;
}>;

// 작업 실패 결과
export type JobFailurePayload = Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "FAILED";
    // 처리 실패 원인을 구별하는 코드
    failureCode: string;
    // 실패 후 재시도 허용 여부
    retryable: boolean;
}>;

// 분석 샷 결과
export type AnalysisShot = Readonly<{
    // 목록 안에서 해당 항목을 식별하는 순번
    index: number;
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 일반 재생과 느린 재생의 구분
    playbackSpeed: "NORMAL" | "SLOW" | "UNKNOWN";
    // 재방송 장면 여부와 미확정 상태
    isReplay: boolean | null;
    // 영상 구간의 촬영 시점 정보
    cameraAngle: string | null;
}>;

// 분석 후보 결과
export type AnalysisCandidate = Readonly<{
    // 동일 물체의 연속 이동 관측
    tracking?: import("@replay/shared-types").TrackingSummary | null;
    // 장면에서 인식한 사건과 근거
    sceneEvent?: import("@replay/shared-types").SceneEvent | null;
    // 규정 사실과 구분하여 보존하는 방송 단서
    broadcastCue?: import("@replay/shared-types").BroadcastCue | null;
    // 목록 안에서 해당 항목을 식별하는 순번
    index: number;
    // 후보 사건의 분류
    category: "OTHER";
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 장면을 대표하는 원본 영상 시각
    anchorMs: number;
    // 관측 또는 판단 근거의 신뢰 수준
    confidence: number;
    // 관측에 필요한 화면의 충분성
    cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
    // 후보 생성 또는 처리 결과의 근거 사유
    reasons: readonly string[];
    // 후보에 연결한 화면 구간 순번 목록
    shotIndices: readonly number[];
    // 판정 전 검증이 필요한 영상 관찰 후보
    observation?: import("@replay/shared-types").SceneObservation | null;
}>;

// 분석 증거 결과
export type AnalysisEvidence = Readonly<{
    // 처리 결과에서 후보 장면을 찾는 순번
    candidateIndex: number;
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "FRAME" | "CLIP";
    // 객체 저장소에서 파일을 찾는 경로
    objectKey: string;
    // 파일 내용의 동일성을 대조하는 해시
    contentSha256: string;
    // 원본 영상 기준 구간 시작 밀리초
    startMs: number;
    // 원본 영상 기준 구간 종료 밀리초
    endMs: number;
    // 영상 또는 증거 이미지의 가로 크기
    width: number | null;
    // 영상 또는 증거 이미지의 세로 크기
    height: number | null;
}>;

// 분석 결과 입력
export type AnalysisPayload = Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "ANALYZED";
    // 영상 처리 절차를 구별하는 버전
    pipelineVersion: string;
    // 처리가 제공하지 못하는 관측의 한계
    limitations: readonly string[];
    // 원본 영상의 화면 구간 목록
    shots: readonly AnalysisShot[];
    // 파울 확정과 별개로 관리하는 후보 장면 목록
    candidates: readonly AnalysisCandidate[];
    // 원본에 연결한 증거 자료 또는 접근 기능
    evidence?: readonly AnalysisEvidence[];
    // 사실 채택과 구분한 모델 관측 처리 자료
    perception?: import("@replay/shared-types").PerceptionRun;
}>;

// 작업자 결과 전송 자료
export type JobResultPayload = ValidationPayload | AnalysisPayload | JobFailurePayload;

// 작업 결과 저장 입력
export type JobResultCommand = Readonly<{
    // Worker 승인 정보와 분리된 서버 검증 비공개 색인 묶음
    privateIncidents?: import("../../../shared/private-incidents").PrivateIncidentBatch;
    // 후보별 자동 규정 평가의 내부 결과 묶음
    automaticReview?: import("@replay/shared-types").AutomaticReviewBatch;
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 작업 임대 권한 비교용 토큰 해시
    leaseTokenHash: Uint8Array;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
    // 작업에 전달하거나 제출하는 자료
    payload: JobResultPayload;
    // 원본과 증거 검증 및 사실 채택 검사 결과
    perceptionVerification?: Readonly<{
        // 분석 기록의 식별자
        analysisId: string;
        // 분석한 원본 영상의 내용 해시
        sourceSha256: Uint8Array;
        // 관측을 규정 사실로 채택할 수 있는지의 검사 결과
        admission: Readonly<{ status: "NOT_ADMITTED"; reasons: readonly string[] }>;
    }>;
}>;

// 작업 결과 저장 상태
export type JobResult =
    | Readonly<{ kind: "ACCEPTED" | "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED" }>
    | Readonly<{ kind: "INVALID_RESULT"; reason: "SOURCE" | "CONTEXT" }>;

// 작업 결과 정의
export type JobResultPreflightCommand = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 작업 임대 권한 비교용 토큰 해시
    leaseTokenHash: Uint8Array;
    // 유효 기한 판단에 사용하는 현재 시각
    now: string;
}>;

// 작업 결과 정의
export type JobResultPreflight =
    | Readonly<{
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "AUTHORIZED";
            // 분석 기록의 식별자
            analysisId: string;
            // 분석한 원본 영상의 내용 해시
            sourceSha256: Uint8Array;
            // 분석 기록이 보존한 원본 해시
            analysisSourceSha256: Uint8Array;
            // 접근과 보존을 허용하는 만료 시각
            expiresAt: string | null;
            // 영상 전체 길이의 밀리초 값
            durationMs?: number | null;
            // 검증된 경기의 적용 규정 판본
            ruleEdition: Readonly<{
                // 다른 기록과 구별하는 고유 식별자
                id: string;
                // 규정 문맥의 검증 상태
                verificationStatus: string;
                // 검증된 경기 기록의 식별자
                matchId: string;
                // 국제 축구 규정의 판본
                ifabEdition: string;
                // 규정 적용 대상 대회
                competition?: string;
                // 규정 적용 대상 시즌
                season?: string;
                // 등록된 경기에서 읽은 실제 경기 날짜
                matchDate?: string;
            }> | null;
        }>
    | Readonly<{ kind: "NOT_FOUND" | "STALE_LEASE" | "ALREADY_FINISHED" }>;

// 작업 결과 저장 포트
export type JobResultStore = Readonly<{
    // 해당 단계의 처리 결과
    result: (command: JobResultCommand) => Promise<JobResult>;
    // 무거운 파일 검사 전 임대와 원본 문맥 확인 기능
    preflight?: (command: JobResultPreflightCommand) => Promise<JobResultPreflight>;
}>;
