// 데이터베이스 연결 테스트
import { describe, expect, it } from "vitest";
import { client } from "@replay/database";

describe("database client", () => {
  it("throws a clear error when DATABASE_URL is absent", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => client()).toThrow("DATABASE_URL is required");
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});
