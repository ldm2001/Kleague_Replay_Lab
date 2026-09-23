// 데이터베이스 연결 도구 가져오기
import postgres from "postgres";
// 마이그레이션 파일 읽기 기능 가져오기
import { migrations } from "./migrations.mjs";

// 데이터베이스 연결 주소 참조
const databaseUrl = process.env.DATABASE_URL;

// 데이터베이스 연결 주소가 빠졌는지 확인
if (!databaseUrl) {
    // 입력 또는 실행 조건을 만족하지 못해 오류 전달
    throw new Error("DATABASE_URL is required");
}

// 실행할 데이터베이스 질의 확인
const sql = postgres(databaseUrl, { max: 1 });
// 마이그레이션 동시 실행을 막는 잠금 이름 계산
const advisoryLockName = "replay_lab_schema_migrations";

// 성공 여부와 관계없이 잠금과 연결을 정리할 실행 구간
try {
    // 마이그레이션 동시 실행 방지 잠금 획득
    await sql`select pg_advisory_lock(hashtext(${advisoryLockName}))`;

    // 마이그레이션 이력 테이블 조회 결과 분리
    const [migrationTable] = await sql`
    select to_regclass('public.schema_migrations') as table_name
  `;

    // 마이그레이션 이력 테이블이 없는지 확인
    if (migrationTable?.table_name === null) {
        // 마이그레이션 적용 이력을 보관할 테이블 생성
        await sql`create table schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    }

    // 이미 적용한 마이그레이션 목록 읽음
    const appliedRows = await sql`select name, checksum from schema_migrations`;
    // 적용 이력에 보존한 파일 해시 보관 공간 생성
    const appliedChecksums = new Map(appliedRows.map((row) => [row.name, row.checksum]));

    // 대상 파일과 항목을 순서대로 검사
    for (const migration of await migrations()) {
        // 해당 마이그레이션의 저장된 해시 조회
        const appliedChecksum = appliedChecksums.get(migration.name);

        // 해당 마이그레이션의 저장된 해시의 조건에 따라 처리 분기
        if (appliedChecksum) {
            // 해당 마이그레이션의 저장된 해시 및 무결성 확인값의 조건에 따라 처리 분기
            if (appliedChecksum !== migration.checksum) {
                // 입력 또는 실행 조건을 만족하지 못해 오류 전달
                throw new Error(`Migration checksum changed: ${migration.name}`);
            }
            // 처리 결과 출력
            console.log(`Migration already applied: ${migration.name}`);
            // 현재 항목은 제외하고 다음 항목 검사
            continue;
        }

        // 같은 트랜잭션 안에서 규정 변경과 적용 이력을 함께 저장
        await sql.begin(async (transaction) => {
            // 현재 마이그레이션의 질의 실행
            await transaction.unsafe(migration.sql);
            // 성공한 마이그레이션의 이름과 해시 기록
            await transaction`
        insert into schema_migrations (name, checksum)
        values (${migration.name}, ${migration.checksum})
      `;
        });
        // 처리 결과 출력
        console.log(`Migration applied: ${migration.name}`);
    }
} finally {
    // 마이그레이션 동시 실행 방지 잠금 해제
    await sql`select pg_advisory_unlock(hashtext(${advisoryLockName}))`.catch(() => undefined);
    // 확인 작업을 마친 데이터베이스 연결 종료
    await sql.end({ timeout: 5 });
}
