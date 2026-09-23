// 데이터베이스 연결 테스트
import { describe, expect, it } from "vitest";
import { client } from "@replay/database";

describe("database client", () => {
    it("throws a clear error when DATABASE_URL is absent", () => {
        // 원본 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
        const originalDatabaseUrl = process.env.DATABASE_URL;
        // 입력 조건 처리 수행
        delete process.env.DATABASE_URL;

        try {
            // 시험 동작 함수의 잘못된 입력의 예외 발생 확인
            expect(() => client()).toThrow("DATABASE_URL is required");
        } finally {
            // 원본 데이터베이스 주소 비교 조건에 따른 처리 경로 분기
            if (originalDatabaseUrl === undefined) {
                // 입력 조건 처리 수행
                delete process.env.DATABASE_URL;
            } else {
                // 실행환경 환경설정 데이터베이스 주소를 원본 데이터베이스 주소 값으로 설정
                process.env.DATABASE_URL = originalDatabaseUrl;
            }
        }
    });
});
