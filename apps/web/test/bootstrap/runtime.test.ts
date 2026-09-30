// 프로세스 공용 설정 조회와 단일 데이터베이스 연결 소유 테스트
import { afterEach, describe, expect, it, vi } from "vitest";
import { env, pool } from "../../src/bootstrap/runtime";

describe("process runtime", () => {
    afterEach(() => {
        // 시험용 환경 변수 원복
        vi.unstubAllEnvs();
    });

    it("reads a required setting and rejects a missing or empty one", () => {
        // 설정된 값 준비
        vi.stubEnv("REPLAY_RUNTIME_SET", "value");
        // 빈 값 준비
        vi.stubEnv("REPLAY_RUNTIME_EMPTY", "");
        // 없는 값 준비
        vi.stubEnv("REPLAY_RUNTIME_MISSING", undefined);

        // 설정된 값 반환 확인
        expect(env("REPLAY_RUNTIME_SET")).toBe("value");
        // 빈 값 거부 확인
        expect(() => env("REPLAY_RUNTIME_EMPTY")).toThrow("REPLAY_RUNTIME_EMPTY is required");
        // 없는 값 거부 확인
        expect(() => env("REPLAY_RUNTIME_MISSING")).toThrow("REPLAY_RUNTIME_MISSING is required");
    });

    it("opens one lazy pool per process without caching a failed attempt", async () => {
        // 주소 없는 실행 환경 준비
        vi.stubEnv("DATABASE_URL", undefined);

        // 주소 누락 시 연결 생성 중단 확인
        expect(() => pool()).toThrow("DATABASE_URL is required");
        // 질의 전에는 접속하지 않는 시험 주소 설정
        vi.stubEnv("DATABASE_URL", "postgres://probe:probe@127.0.0.1:9/probe");
        // 실패 뒤 첫 연결
        const first = pool();
        // 이후 요청의 같은 연결 재사용 확인
        expect(pool()).toBe(first);
        // 실행 중 주소 변경
        vi.stubEnv("DATABASE_URL", "postgres://other:other@127.0.0.1:9/other");
        // 주소가 바뀌어도 프로세스 연결 유지 확인
        expect(pool()).toBe(first);
        // 접속한 적 없는 연결 종료
        await first.close();
    });
});
