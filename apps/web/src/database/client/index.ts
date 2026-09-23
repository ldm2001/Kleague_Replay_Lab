// 저장소 질의와 자료 구조 정의 기능 가져옴
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
// 데이터베이스 연결 기능 가져옴
import postgres, { type Sql } from "postgres";
// 저장 자료 구조와 허용 상태 목록 가져옴
import * as schema from "../schema/tables";

// 일반 질의와 원시 연결 및 종료 기능을 묶은 데이터베이스 계약 정의
export type DatabaseClient = {
    // 자료 조회와 트랜잭션을 제공하는 데이터베이스 연결
    db: PostgresJsDatabase<typeof schema>;
    // 원시 질의를 실행하는 연결
    sql: Sql;
    // 사용을 마친 데이터베이스 연결 종료 기능
    close: () => Promise<void>;
};

// 관계형 데이터베이스 연결 생성
export const client = (databaseUrl = process.env.DATABASE_URL): DatabaseClient => {
    // 데이터베이스 주소 확인
    if (!databaseUrl) {
        // 데이터베이스 주소 누락을 연결 생성 오류로 전달
        throw new Error("DATABASE_URL is required");
    }

    // 관계형 데이터베이스 연결 생성
    const sql = postgres(databaseUrl, {
        // 동시에 유지하는 연결 수 제한
        max: 5,
        // 미사용 연결을 정리하기까지의 대기 시간
        idle_timeout: 20,
        // 새 연결을 기다리는 최대 시간
        connect_timeout: 10,
    });

    // 데이터 접근 계층 데이터베이스 객체 구성
    return {
        // 자료 조회와 트랜잭션을 제공하는 데이터베이스 연결
        db: drizzle(sql, { schema }),
        // 원시 질의를 실행하는 연결
        sql,
        // 사용을 마친 데이터베이스 연결 종료 기능
        close: () => sql.end({ timeout: 5 }),
    };
};
