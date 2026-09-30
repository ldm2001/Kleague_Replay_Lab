// 추측할 수 없는 비밀 토큰 생성 계약 정의
export type Secret = Readonly<{
    // 세션과 작업 임대를 증명하는 새 비밀 토큰
    token: () => string;
}>;
