// 식별자와 해시 생성 도구 가져오기
import { createHash as digest } from "node:crypto";
// 비동기 파일 접근 도구 가져오기
import { readdir, readFile } from "node:fs/promises";
// 주소와 파일 경로 변환 도구 가져오기
import { fileURLToPath } from "node:url";

// 마이그레이션 파일을 읽을 폴더 주소 계산
const migrationDirectoryUrl = new URL("../../apps/web/src/database/migrations/", import.meta.url);

// 순서대로 실행할 마이그레이션 목록 조회
export const migrations = async () => {
    // 항목 이름과 값의 묶음 읽음
    const entries = await readdir(fileURLToPath(migrationDirectoryUrl), { withFileTypes: true });
    // 실행 순서의 마이그레이션 파일 이름 선별
    const migrationNames = entries
        .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    // 동일한 내용을 비교할 해시값 반환
    return Promise.all(
        migrationNames.map(async (fileName) => {
            // 실행할 데이터베이스 질의 읽음
            const sql = await readFile(new URL(fileName, migrationDirectoryUrl), "utf8");
            // 호출자가 사용할 결과 항목을 하나의 객체로 반환
            return {
                // 항목 이름 기록
                name: fileName.replace(/\.sql$/, ""),
                // 실행할 데이터베이스 질의 기록
                sql,
                // 무결성 확인값 기록
                checksum: digest("sha256").update(sql).digest("hex"),
            };
        }),
    );
};
