// 주소와 파일 경로 변환 도구 가져오기
import { fileURLToPath } from "node:url";
// 테스트 실행 설정 도구 가져오기
import { defineConfig } from "vitest/config";

// 경로 처리
const packagePath = (relativePath: string) =>
    fileURLToPath(new URL(relativePath, import.meta.url));

// 설정한 실행 구성을 모듈의 기본값으로 공개
export default defineConfig({
    // 코드 모듈 경로 연결 설정 기록
    resolve: {
        // 모듈 별칭과 실제 폴더의 연결 기록
        alias: {
            // 요청 처리 흐름의 실제 코드 위치 연결
            "@replay/application": packagePath("./apps/web/src/application/index.ts"),
            // 데이터베이스 접근 기능의 실제 코드 위치 연결
            "@replay/database": packagePath("./apps/web/src/database/index.ts"),
            // 외부 저장소 연결 기능의 실제 코드 위치 연결
            "@replay/adapters": packagePath("./apps/web/src/adapters/index.ts"),
            // 공통 관측과 판정 자료형의 실제 코드 위치 연결
            "@replay/shared-types": packagePath("./apps/web/src/shared/index.ts"),
            // 규정 자료 조회 기능의 실제 코드 위치 연결
            "@replay/rule-data": packagePath("./apps/web/src/rules/data/index.ts"),
            // 규정 판정 기능의 실제 코드 위치 연결
            "@replay/rule-engine": packagePath("./apps/web/src/rules/engine/index.ts"),
        },
    },
    // 테스트 실행 설정 기록
    test: {
        // 같은 테스트 데이터베이스의 작업 큐를 서로 다른 파일이 선점하지 않도록 순차 실행
        fileParallelism: !process.env.DATABASE_URL,
        // 검사할 파일 범위 기록
        include: ["apps/web/test/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
    },
});
