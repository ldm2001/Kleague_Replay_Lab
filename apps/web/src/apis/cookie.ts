// 익명 세션 토큰을 담는 쿠키 이름 지정
const NAME = "replay_session";

// 퍼센트 인코딩 해석으로 손상된 값은 없음 반환
const decode = (value: string): string | null => {
    // 잘못된 인코딩의 예외를 없는 값으로 바꾸는 경계 설정
    try {
        // 해석한 원문 반환
        return decodeURIComponent(value);
    } catch {
        // 발급한 토큰일 수 없는 손상 값을 없음으로 반환
        return null;
    }
};

// 요청 쿠키에서 해석 가능한 첫 세션 토큰 추출
export const token = (request: Request): string | null => {
    // 요청 쿠키 헤더 조회
    const header = request.headers.get("cookie");
    // 쿠키가 없으면 빈 결과 반환
    if (!header) return null;
    // 세션 쿠키 항목 탐색
    for (const item of header.split(";")) {
        // 쿠키 이름과 값 분리
        const [name, ...parts] = item.trim().split("=");
        // 이름이 같고 인코딩이 온전한 값만 세션 토큰으로 사용
        const value = name === NAME ? decode(parts.join("=")) : null;
        // 해석한 세션 토큰 반환
        if (value !== null) return value;
    }
    // 세션 토큰 없음 반환
    return null;
};

// 세션 토큰과 세션 정책의 유효 기간으로 응답 쿠키 헤더 생성
export const cookie = (value: string, ttlMs: number): string =>
    [
        `${NAME}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.floor(ttlMs / 1000)}`
    ].join("; ");
