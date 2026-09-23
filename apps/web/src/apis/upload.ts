// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    CompletionInput,
    CompletionResult,
    UploadInput,
    UploadResult,
    SessionGrant,
    SessionRecord
} from "@replay/application";

// 업로드 요청 처리 의존 기능 계약 정의
export type UploadApiDependencies = Readonly<{
    // 새 익명 세션 권한 발급 기능
    issue: () => Promise<SessionGrant>;
    // 접근 토큰에서 세션 기록을 찾는 기능
    resolve: (token: string) => Promise<SessionRecord | null>;
    // 영상 업로드 허가 처리
    upload: (input: UploadInput) => Promise<UploadResult>;
    // 업로드 완료와 후속 영상 검증 연결
    complete: (input: CompletionInput) => Promise<CompletionResult>;
}>;

// 익명 세션 토큰을 저장하는 쿠키 이름 지정
const COOKIE = "replay_session";
// 익명 세션 쿠키의 하루 보존 시간을 초 단위로 지정
const COOKIE_MAX_AGE = 24 * 60 * 60;

// 직렬화 자료 응답 생성
const json = (body: unknown, status: number, headers?: Record<string, string>): Response =>
    new Response(JSON.stringify(body), {
        // 처리 상태 또는 요청 응답 상태
        status,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: {
            // 다른 요청에 비공개 결과가 재사용되지 않도록 하는 캐시 정책
            "cache-control": "no-store",
            // 응답 본문의 자료 형식
            "content-type": "application/json; charset=utf-8",
            ...headers,
        },
    });

// 세션 쿠키 조회
const cookie = (request: Request): string | null => {
    // 요청 쿠키 헤더 조회
    const value = request.headers.get("cookie");
    // 쿠키가 없으면 빈 결과 반환
    if (!value) return null;
    // 세션 쿠키 항목 탐색
    for (const item of value.split(";")) {
        // 쿠키 이름과 값 분리
        const [name, ...parts] = item.trim().split("=");
        // 세션 쿠키 반환
        if (name === COOKIE) return decodeURIComponent(parts.join("="));
    }
    // 세션 쿠키 없음 반환
    return null;
};

// 세션 쿠키 헤더 생성
const headerCookie = (token: string): string =>
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;

// 요청 본문 읽기
const body = async (request: Request): Promise<Record<string, unknown> | null> => {
    // 잘못된 본문 해석을 요청 실패로 분리하는 예외 경계 설정
    try {
        // 요청 직렬화 자료 본문 조회
        const value: unknown = await request.json();
        // 객체 본문만 반환
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    } catch {
        // 직렬화 자료 해석 실패 반환
        return null;
    }
};

// 업로드 입력 변환
const payload = (
    value: Record<string, unknown>
): Omit<UploadInput, "anonymousSessionId"> | null => {
    // 업로드 필수 필드 확인
    if (
        typeof value.expectedSizeBytes !== "number" ||
        !Number.isSafeInteger(value.expectedSizeBytes) ||
        typeof value.declaredContentType !== "string" ||
        typeof value.rightsConfirmed !== "boolean"
    ) {
        // 형식이 맞지 않으면 입력 거부
        return null;
    }
    // 업로드 입력 반환
    return {
        // 업로드 전에 신고한 파일 바이트 크기
        expectedSizeBytes: value.expectedSizeBytes,
        // 업로드 전에 신고한 콘텐츠 형식
        declaredContentType: value.declaredContentType,
        // 영상 사용 권리 확인 여부
        rightsConfirmed: value.rightsConfirmed,
        ...(typeof value.competition === "string" ? { competition: value.competition } : {}),
        ...(typeof value.season === "string" ? { season: value.season } : {})
    };
};

// 업로드 상태 코드
const uploadStatus = (result: UploadResult): number => {
    // 업로드 생성 결과를 응답 상태로 변환
    switch (result.kind) {
        // 새 기록 생성에 대응하는 응답 분기
        case "CREATED": return 201;
        // 사용할 수 없는 세션에 대응하는 응답 분기
        case "SESSION_UNAVAILABLE": return 401;
        // 별도 응답 규칙이 없는 실패를 입력 오류로 분류
        default: return 400;
    }
};

// 완료 상태 코드
const completionStatus = (result: CompletionResult): number => {
    // 업로드 완료 결과를 응답 상태로 변환
    switch (result.kind) {
        // 업로드 완료에 대응하는 응답 분기
        case "COMPLETED": return 202;
        // 업로드 기록 없음에 대응하는 응답 분기
        case "UPLOAD_NOT_FOUND": return 404;
        // 이미 완료된 업로드에 대응하는 응답 분기
        case "UPLOAD_ALREADY_COMPLETED": return 409;
        // 아직 준비되지 않은 업로드에 대응하는 응답 분기
        case "UPLOAD_NOT_READY": return 409;
        // 파일 검증 실패에 대응하는 응답 분기
        case "UPLOAD_INVALID": return 422;
        // 별도 응답 규칙이 없는 실패를 입력 오류로 분류
        default: return 400;
    }
};

// 업로드 요청
export const upload = async (
    request: Request,
    dependencies: UploadApiDependencies
): Promise<Response> => {
    // 요청 본문 조회
    const value = await body(request);
    // 입력 자료 변환
    const input = value ? payload(value) : null;
    // 입력 검증
    if (!input) {
        // 잘못된 요청 응답
        return json({ kind: "INVALID_REQUEST" }, 400);
    }

    // 기존 세션 조회
    let record = await dependencies.resolve(cookie(request) ?? "");
    // 새 세션 기본값
    let issued: SessionGrant | null = null;
    // 세션 존재 확인
    if (!record) {
        // 익명 세션 발급
        issued = await dependencies.issue();
        // 발급 세션 적용
        record = issued;
    }

    // 익명 세션을 포함한 업로드 입력 구성
    // 업로드 유스케이스 호출
    const result = await dependencies.upload({ ...input, anonymousSessionId: record.sessionId });
    // 업로드 결과 응답
    return json(
        result,
        uploadStatus(result),
        issued ? { "set-cookie": headerCookie(issued.token) } : undefined
    );
};

// 업로드 완료 요청
export const completion = async (
    request: Request,
    params: Readonly<{ intentId: string }>,
    dependencies: UploadApiDependencies,
): Promise<Response> => {
    // 세션 쿠키 확인
    const record = await dependencies.resolve(cookie(request) ?? "");
    // 세션 권한 확인
    if (!record) {
        // 인증 실패 응답
        return json({ kind: "UNAUTHORIZED" }, 401);
    }

    // 완료 요청에 세션 식별자 연결
    // 완료 유스케이스 호출
    const result = await dependencies.complete({
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: record.sessionId,
        // 업로드 허가 기록의 식별자
        uploadIntentId: params.intentId,
    });
    // 완료 결과 응답
    return json(result, completionStatus(result));
};
