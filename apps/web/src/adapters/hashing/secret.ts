// 암호학적 난수 생성 기능 가져옴
import { randomBytes } from "node:crypto";
// 비밀 토큰 생성 계약 가져옴
import type { Secret } from "@replay/application";

// 32바이트 난수를 주소 안전 문자열로 만드는 비밀 토큰 어댑터 생성
export const secret = (): Secret => ({
    // 새 비밀 토큰 생성
    token: () => randomBytes(32).toString("base64url")
});
