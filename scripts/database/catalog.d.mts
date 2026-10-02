// 순서대로 실행할 데이터베이스 변경 파일의 자료 구조 정의
export type Migration = {
    // 항목 이름
    name: string;
    // 실행할 데이터베이스 질의
    sql: string;
    // 무결성 확인값
    checksum: string;
};

// 실행 순서의 마이그레이션 목록 반환
export const migrations: () => Promise<Migration[]>;
