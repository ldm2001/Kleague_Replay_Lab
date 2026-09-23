// 비밀 토큰과 파일 내용의 해시 계산 계약 정의
export type Hasher = Readonly<{
    // 유니코드 문자열의 보안 해시 바이트
    sha256: (value: string) => Promise<Uint8Array>;
}>;
