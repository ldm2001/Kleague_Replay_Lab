// 비밀 토큰과 보안 해시 어댑터 테스트
import { createHash as digest } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hash, secret } from "@replay/adapters";

describe("secret", () => {
    it("issues distinct url safe tokens from 32 random bytes", () => {
        // 비밀 토큰 어댑터 생성
        const source = secret();
        // 비밀 토큰 100개 발급
        const tokens = Array.from({ length: 100 }, () => source.token());

        // 발급 토큰 순회
        for (const token of tokens) {
            // 32바이트 난수의 패딩 없는 주소 안전 문자열 길이 확인
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        }
        // 발급 토큰이 서로 겹치지 않음 확인
        expect(new Set(tokens).size).toBe(tokens.length);
    });
});

describe("hash", () => {
    it("hashes the utf8 bytes of a token with sha256", async () => {
        // 한글을 포함한 시험 토큰 준비
        const token = "세션-token";

        // 해시 결과가 표준 SHA 256 바이트와 같음 확인
        await expect(hash().sha256(token)).resolves.toEqual(
            Uint8Array.from(digest("sha256").update(token, "utf8").digest())
        );
    });
});
