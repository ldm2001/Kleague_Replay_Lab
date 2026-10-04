import { describe, expect, it } from "vitest";
import { cookie, token } from "../../src/apis/cookie.js";

// 쿠키 헤더를 담은 요청 생성
const request = (header?: string): Request =>
    new Request("http://localhost/api", header === undefined ? {} : { headers: { cookie: header } });

describe("session cookie", () => {
    it.each<[string | undefined, string | null]>([
        [undefined, null],
        ["", null],
        ["theme=dark", null],
        ["xreplay_session=abc", null],
        ["replay_session=abc", "abc"],
        ["theme=dark; replay_session=abc; lang=ko", "abc"],
        ["replay_session=a%2Bb%3D", "a+b="],
        ["replay_session=a=b", "a=b"],
        ["replay_session=", ""],
        ["replay_session=first; replay_session=second", "first"],
        ["replay_session=%", null],
        ["replay_session=%E0%A4%A", null],
        ["replay_session=%ZZ", null],
        ["replay_session=%; replay_session=abc", "abc"]
    ])("reads the cookie header %j as %j", (header, expected) => {
        // 손상된 인코딩은 예외 대신 없는 값으로 건너뜀 확인
        expect(token(request(header))).toBe(expected);
    });

    it("writes the session cookie with the policy lifetime in whole seconds", () => {
        // 기존 응답 헤더와 같은 속성 순서와 하루 보존 시간 확인
        expect(cookie("session-token", 24 * 60 * 60 * 1000)).toBe(
            "replay_session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
        );
        // 초 미만 유효 기간은 서버 만료보다 늦지 않게 내림 확인
        expect(cookie("session-token", 1999)).toContain("Max-Age=1");
    });

    it("reads back every token value it writes", () => {
        // 구분 기호와 퍼센트 기호 및 공백과 비아스키 문자를 담은 토큰
        const value = "a b;c%d=é";
        // 응답 쿠키의 이름과 값 조각
        const [pair = ""] = cookie(value, 1000).split("; ");

        // 발급한 값이 같은 값으로 다시 읽힘 확인
        expect(token(request(pair))).toBe(value);
    });
});
