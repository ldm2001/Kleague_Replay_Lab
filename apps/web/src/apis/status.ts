// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    LatestInput,
    LatestResult,
    SessionRecord,
    StatusInput,
    StatusResult
} from "@replay/application";

// 상태 요청 처리 의존 기능 계약 정의
export type StatusApiDependencies = Readonly<{
    // 접근 토큰에서 세션 기록을 찾는 기능
    resolve: (token: string) => Promise<SessionRecord | null>;
    // 처리 상태 또는 요청 응답 상태
    status: (input: StatusInput) => Promise<StatusResult>;
    // 현재 세션의 최근 업로드 조회 기능
    latest: (input: LatestInput) => Promise<LatestResult>;
}>;

// 직렬화 자료 응답 생성
const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        // 처리 상태 또는 요청 응답 상태
        status,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: {
            // 다른 요청에 비공개 결과가 재사용되지 않도록 하는 캐시 정책
            "cache-control": "private, no-store",
            // 응답 본문의 자료 형식
            "content-type": "application/json; charset=utf-8",
        },
    });

// 세션 쿠키 추출
const token = (request: Request): string | null => {
    // 요청 쿠키 헤더 조회
    const value = request.headers.get("cookie");
    // 쿠키가 없으면 빈 결과 반환
    if (!value) return null;
    // 세션 쿠키 항목 탐색
    for (const item of value.split(";")) {
        // 쿠키 이름과 값 분리
        const [name, ...parts] = item.trim().split("=");
        // 세션 토큰 반환
        if (name === "replay_session") return decodeURIComponent(parts.join("="));
    }
    // 세션 토큰 없음 반환
    return null;
};

// 저장된 미디어의 접근 정보 조회
export const media = async (
    request: Request,
    params: Readonly<{ videoAssetId: string }>,
    dependencies: StatusApiDependencies,
): Promise<Response> => {
    // 세션 쿠키로 익명 세션 조회
    const record = await dependencies.resolve(token(request) ?? "");
    // 세션이 없으면 상태 조회 차단
    if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
    // 영상 상태 조회 유스케이스 호출
    const result = await dependencies.status({
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: record.sessionId,
        // 업로드된 원본 영상 기록의 식별자
        videoAssetId: params.videoAssetId,
    });
    // 입력 오류 응답
    if (result && "kind" in result) return json(result, 400);
    // 대상 영상 없음 응답
    if (!result) return json({ kind: "NOT_FOUND" }, 404);
    // 영상 상태 응답
    return json(result, 200);
};

// 최근 업로드 조회
export const recent = async (
    request: Request,
    dependencies: StatusApiDependencies,
): Promise<Response> => {
    // 세션 쿠키로 익명 세션 조회
    const record = await dependencies.resolve(token(request) ?? "");
    // 세션이 없으면 최근 결과 조회 차단
    if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
    // 최근 결과 조회 유스케이스 호출
    const result = await dependencies.latest({ anonymousSessionId: record.sessionId });
    // 입력 오류 응답
    if (result && "kind" in result) return json(result, 400);
    // 최근 결과 없음 응답
    if (!result) return json({ kind: "NOT_FOUND" }, 404);
    // 최근 결과 응답
    return json(result, 200);
};
