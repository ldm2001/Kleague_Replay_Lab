import { describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/client/index.js";

describe("database client", () => {
  it("throws a clear error when DATABASE_URL is absent", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => createDatabaseClient()).toThrow("DATABASE_URL is required");
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});
