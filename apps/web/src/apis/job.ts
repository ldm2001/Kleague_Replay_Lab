// 비밀 토큰과 파일 해시의 암호 기능 가져옴
import { timingSafeEqual } from "node:crypto";
// 공유 자료 계약과 검증 기능 가져옴
import { WORKER_PROTOCOL } from "@replay/shared-types";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    ClaimInput,
    ClaimResult,
    JobProgress,
    JobStage,
    JobType,
    ProgressInput,
    ProgressResult,
    ResultInput,
    ResultResult,
    EvidenceInput,
    EvidenceResult
} from "@replay/application";

// 작업 요청 처리 의존 기능 계약 정의
export type JobApiDependencies = Readonly<{
    // 작업자 요청 인증에 사용하는 비밀 값
    key: string;
    // 작업 선점과 원본 접근 권한 발급
    claim: (input: ClaimInput) => Promise<ClaimResult>;
    // 현재 작업 임대의 진행 상태 갱신
    progress: (input: ProgressInput) => Promise<ProgressResult>;
    // 해당 단계의 처리 결과
    result: (input: ResultInput) => Promise<ResultResult>;
    // 원본에 연결한 증거 자료 또는 접근 기능
    evidence: (input: EvidenceInput) => Promise<EvidenceResult>;
}>;

// 직렬화 자료 응답 생성
const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        // 처리 상태 또는 요청 응답 상태
        status,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: {
            // 다른 요청에 비공개 결과가 재사용되지 않도록 하는 캐시 정책
            "cache-control": "no-store",
            // 응답 본문의 자료 형식
            "content-type": "application/json; charset=utf-8",
        },
    });

// 작업자 인증 확인
const auth = (request: Request, key: string): boolean => {
    // 요청 헤더에서 작업자 인증 값 읽음
    const value = request.headers.get("x-worker-key");
    // 제출 인증 값이나 서버 비밀 값이 없으면 인증 거부
    if (!value || !key) return false;
    // 일정 시간 비교를 위해 제출 인증 값을 바이트로 변환
    const left = Buffer.from(value, "utf8");
    // 일정 시간 비교를 위해 서버 인증 값을 바이트로 변환
    const right = Buffer.from(key, "utf8");
    // 길이 일치 후 일정 시간 비교로 인증 성공 여부 반환
    return left.length === right.length && timingSafeEqual(left, right);
};

// 인증과 실행 계약 확인 후 본문과 작업 임대 접근 허용
const access = (request: Request, key: string): Response | null => {
    // 작업자 인증 실패 시 요청 처리 차단
    if (!auth(request, key)) return json({ kind: "UNAUTHORIZED" }, 401);
    // 서버와 작업자의 통신 계약 버전 불일치 확인
    if (request.headers.get("x-worker-protocol") !== WORKER_PROTOCOL) {
        // 필요한 통신 계약 버전과 충돌 응답 반환
        return json(
            { kind: "UNSUPPORTED_WORKER_PROTOCOL", requiredProtocol: WORKER_PROTOCOL },
            409
        );
    }
    // 인증과 통신 계약 검사를 통과한 경우 거부 응답 없음 반환
    return null;
};

// 요청 본문 읽기
const body = async (request: Request): Promise<Record<string, unknown> | null> => {
    // 본문 해석 오류를 입력 거부로 바꾸는 예외 경계 설정
    try {
        // 형식을 아직 신뢰하지 않고 요청 본문 해석
        const value: unknown = await request.json();
        // 배열이나 빈 값이 아닌 객체 본문만 반환
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    } catch {
        // 해석할 수 없는 본문을 입력 거부 값으로 반환
        return null;
    }
};

// 작업 요청 변환
const payload = (value: Record<string, unknown>): ClaimInput | null => {
    // 작업 선점 필드 확인
    if (typeof value.workerId !== "string" || typeof value.jobType !== "string") {
        // 필수 필드가 없으면 입력 거부
        return null;
    }
    // 작업 선점 입력 반환
    return {
        // 작업을 수행하는 실행자의 식별자
        workerId: value.workerId,
        // 영상 검증과 분석의 작업 구분
        jobType: value.jobType as JobType,
    };
};

// 진행 요청 변환
const progressInput = (value: Record<string, unknown>, jobId: string): ProgressInput | null => {
    // 작업 임대와 진행률의 필수 자료형을 확인하여 잘못된 갱신 차단
    if (
        typeof value.workerId !== "string" ||
        typeof value.jobRevision !== "number" ||
        typeof value.leaseToken !== "string" ||
        typeof value.stage !== "string" ||
        typeof value.progressPercent !== "number" ||
        (value.message !== undefined && typeof value.message !== "string")
    ) {
        // 진행 요청 형식 거부
        return null;
    }
    // 선택 메시지 정리
    const message = typeof value.message === "string" ? value.message : undefined;
    // 진행 입력 반환
    return {
        // 처리 작업의 식별자
        jobId,
        // 작업을 수행하는 실행자의 식별자
        workerId: value.workerId,
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: value.jobRevision,
        // 현재 작업 임대를 증명하는 비밀 토큰
        leaseToken: value.leaseToken,
        // 현재 영상 처리 단계
        stage: value.stage as JobStage,
        // 작업 진행률의 백분율
        progressPercent: value.progressPercent,
        ...(message === undefined ? {} : { message }),
    };
};

// 결과 처리
const resultInput = (value: Record<string, unknown>, jobId: string): ResultInput | null => {
    // 작업 결과 요청의 필수 필드 확인
    if (
        typeof value.workerId !== "string" ||
        typeof value.jobRevision !== "number" ||
        typeof value.leaseToken !== "string" ||
        typeof value.payload !== "object" ||
        value.payload === null ||
        Array.isArray(value.payload)
    ) {
        // 형식이 맞지 않는 요청 차단
        return null;
    }
    // 작업 결과 입력 구성
    return {
        // 처리 작업의 식별자
        jobId,
        // 작업을 수행하는 실행자의 식별자
        workerId: value.workerId,
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: value.jobRevision,
        // 현재 작업 임대를 증명하는 비밀 토큰
        leaseToken: value.leaseToken,
        // 작업에 전달하거나 제출하는 자료
        payload: value.payload as ResultInput["payload"],
    };
};

// 증거 처리
const evidenceInput = (value: Record<string, unknown>, jobId: string): EvidenceInput | null => {
    // 증거 권한 요청의 공통 필드 확인
    if (
        typeof value.workerId !== "string" ||
        typeof value.jobRevision !== "number" ||
        typeof value.leaseToken !== "string" ||
        !Array.isArray(value.items)
    ) {
        // 형식이 맞지 않는 요청 차단
        return null;
    }
    // 증거 항목 배열 초기화
    const items: Array<EvidenceInput["items"][number]> = [];
    // 요청된 증거 항목 검증
    for (const item of value.items) {
        // 증거 항목의 이름과 형식 및 크기 자료형 확인
        if (
            typeof item !== "object" ||
            item === null ||
            Array.isArray(item) ||
            typeof item.name !== "string" ||
            typeof item.contentType !== "string" ||
            typeof item.sizeBytes !== "number" ||
            (item.contentSha256 !== undefined && typeof item.contentSha256 !== "string")
        ) {
            // 잘못된 증거 항목 차단
            return null;
        }
        // 검증된 증거 항목 저장
        items.push({
            // 저장소 요청에서 사용하는 파일 이름
            name: item.name,
            // 파일의 실제 또는 허용 콘텐츠 형식
            contentType: item.contentType as EvidenceInput["items"][number]["contentType"],
            // 파일의 바이트 크기
            sizeBytes: item.sizeBytes,
            ...(typeof item.contentSha256 === "string" ? { contentSha256: item.contentSha256 } : {})
        });
    }
    // 증거 권한 입력 구성
    return {
        // 처리 작업의 식별자
        jobId,
        // 작업을 수행하는 실행자의 식별자
        workerId: value.workerId,
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: value.jobRevision,
        // 현재 작업 임대를 증명하는 비밀 토큰
        leaseToken: value.leaseToken,
        // 한 요청에서 처리할 항목 목록
        items
    };
};

// 진행 상태 코드
const progressStatus = (result: JobProgress): number => {
    // 진행 처리 결과를 응답 상태로 변환
    switch (result.kind) {
        // 진행 상태 갱신에 대응하는 응답 분기
        case "UPDATED": return 200;
        // 대상 기록 없음에 대응하는 응답 분기
        case "NOT_FOUND": return 404;
        // 만료되거나 교체된 작업 임대에 대응하는 응답 분기
        case "STALE_LEASE": return 409;
    }
};

// 결과 처리
const resultStatus = (value: ResultResult): number => {
    // 작업 결과 처리 결과를 응답 상태로 변환
    switch (value.kind) {
        // 작업 결과 접수에 대응하는 응답 분기
        case "ACCEPTED": return 200;
        // 대상 기록 없음에 대응하는 응답 분기
        case "NOT_FOUND": return 404;
        // 만료되거나 교체된 작업 임대에 대응하는 응답 분기
        case "STALE_LEASE": return 409;
        // 이미 종료된 작업에 대응하는 응답 분기
        case "ALREADY_FINISHED": return 409;
        // 입력 계약 위반에 대응하는 응답 분기
        case "INVALID_INPUT": return 400;
        // 제출 결과 검증 실패에 대응하는 응답 분기
        case "INVALID_RESULT": return 400;
    }
};

// 증거 처리
const evidenceStatus = (value: EvidenceResult): number => {
    // 증거 권한 처리 결과를 응답 상태로 변환
    switch (value.kind) {
        // 접근 권한 발급에 대응하는 응답 분기
        case "GRANTED": return 200;
        // 대상 기록 없음에 대응하는 응답 분기
        case "NOT_FOUND": return 404;
        // 만료되거나 교체된 작업 임대에 대응하는 응답 분기
        case "STALE_LEASE": return 409;
        // 이미 종료된 작업에 대응하는 응답 분기
        case "ALREADY_FINISHED": return 409;
        // 입력 계약 위반에 대응하는 응답 분기
        case "INVALID_INPUT": return 400;
        // 필요한 저장소 기능 부재에 대응하는 응답 분기
        case "UNAVAILABLE": return 503;
    }
};

// 작업 선점 요청
export const claim = async (
    request: Request,
    dependencies: JobApiDependencies
): Promise<Response> => {
    // 작업자 인증과 통신 계약 위반 응답 확인
    const denied = access(request, dependencies.key);
    // 인증 또는 통신 계약이 거부한 응답을 즉시 반환
    if (denied) return denied;

    // 요청 본문 조회
    const value = await body(request);
    // 작업 요청 변환
    const input = value ? payload(value) : null;
    // 요청 형식 확인
    if (!input) {
        // 잘못된 요청 응답
        return json({ kind: "INVALID_REQUEST" }, 400);
    }

    // 작업 선점 유스케이스 호출
    const result = await dependencies.claim(input);
    // 입력 오류 응답
    if (result && "kind" in result && result.kind === "INVALID_INPUT") {
        // 작업 선점 입력 오류를 잘못된 요청 응답으로 반환
        return json(result, 400);
    }
    // 작업 없음 응답
    if (!result) {
        // 선점 가능한 작업이 없음을 빈 응답으로 반환
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    // 작업 선점 결과 응답
    return json(result, 200);
};

// 진행 상태 요청
export const progress = async (
    request: Request,
    params: Readonly<{ jobId: string }>,
    dependencies: JobApiDependencies,
): Promise<Response> => {
    // 작업자 인증과 통신 계약 위반 응답 확인
    const denied = access(request, dependencies.key);
    // 인증 또는 통신 계약이 거부한 응답을 즉시 반환
    if (denied) return denied;
    // 요청 본문 조회
    const value = await body(request);
    // 진행 요청 변환
    const input = value ? progressInput(value, params.jobId) : null;
    // 요청 형식 확인
    if (!input) {
        // 잘못된 요청 응답
        return json({ kind: "INVALID_REQUEST" }, 400);
    }
    // 진행 유스케이스 호출
    const result = await dependencies.progress(input);
    // 입력 오류 응답
    if ("kind" in result && result.kind === "INVALID_INPUT") {
        // 진행 보고 입력 오류를 잘못된 요청 응답으로 반환
        return json(result, 400);
    }
    // 진행 결과 응답
    return json(result, progressStatus(result));
};

// 결과 처리
export const result = async (
    request: Request,
    params: Readonly<{ jobId: string }>,
    dependencies: JobApiDependencies,
): Promise<Response> => {
    // 작업자 인증과 통신 계약 위반 응답 확인
    const denied = access(request, dependencies.key);
    // 인증 또는 통신 계약이 거부한 응답을 즉시 반환
    if (denied) return denied;
    // 요청 본문 조회
    const value = await body(request);
    // 작업 결과 입력 변환
    const input = value ? resultInput(value, params.jobId) : null;
    // 요청 형식 확인
    if (!input) {
        // 잘못된 요청 응답
        return json({ kind: "INVALID_REQUEST" }, 400);
    }
    // 작업 결과 유스케이스 호출
    const response = await dependencies.result(input);
    // 작업 결과 응답
    return json(response, resultStatus(response));
};

// 증거 처리
export const evidence = async (
    request: Request,
    params: Readonly<{ jobId: string }>,
    dependencies: JobApiDependencies,
): Promise<Response> => {
    // 작업자 인증과 통신 계약 위반 응답 확인
    const denied = access(request, dependencies.key);
    // 인증 또는 통신 계약이 거부한 응답을 즉시 반환
    if (denied) return denied;
    // 요청 본문 조회
    const value = await body(request);
    // 증거 권한 입력 변환
    const input = value ? evidenceInput(value, params.jobId) : null;
    // 요청 형식 확인
    if (!input) return json({ kind: "INVALID_REQUEST" }, 400);
    // 증거 권한 유스케이스 호출
    const response = await dependencies.evidence(input);
    // 증거 권한 응답
    return json(response, evidenceStatus(response));
};
