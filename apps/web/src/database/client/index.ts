import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../schema/tables";

export type DatabaseClient = {
  db: PostgresJsDatabase<typeof schema>;
  sql: Sql;
  close: () => Promise<void>;
};

// PostgreSQL 연결 생성
export const client = (databaseUrl = process.env.DATABASE_URL): DatabaseClient => {
  // 데이터베이스 주소 확인
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  // PostgreSQL 연결 생성
  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  // Drizzle 데이터베이스 객체 구성
  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
};
