// 데이터베이스 연결 도구 가져오기
import postgres from "postgres";

// 데이터베이스 연결 주소 참조
const databaseUrl = process.env.DATABASE_URL;

// 데이터베이스 연결 주소가 빠졌는지 확인
if (!databaseUrl) {
    // 입력 또는 실행 조건을 만족하지 못해 오류 전달
    throw new Error("DATABASE_URL is required");
}

// 실행할 데이터베이스 질의 확인
const sql = postgres(databaseUrl, { max: 1 });

// 통계 조회 성공 여부와 관계없이 연결을 닫을 실행 구간
try {
    // 질의 통계를 조회할 확장 기능 준비
    await sql`create extension if not exists pg_stat_statements`;
    // 처리 결과 출력
    console.log("pg_stat_statements enabled");
} finally {
    // 확인 작업을 마친 데이터베이스 연결 종료
    await sql.end({ timeout: 5 });
}
