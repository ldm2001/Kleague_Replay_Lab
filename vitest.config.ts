// 주소와 파일 경로 변환 도구 가져오기
import { fileURLToPath } from "node:url";
// 주석을 허용하는 타입 설정 읽기 도구 가져오기
import ts from "typescript";
// 테스트 실행 설정 도구 가져오기
import { defineConfig } from "vitest/config";

// 경로 처리
const packagePath = (relativePath: string) =>
    fileURLToPath(new URL(relativePath, import.meta.url));

// 타입 검사와 Next가 함께 쓰는 경로 별칭의 원본 설정
const tsconfig = ts.readConfigFile(packagePath("./tsconfig.base.json"), ts.sys.readFile);

// 별칭 원본을 읽지 못하면 테스트가 다른 파일을 해석하지 않도록 실행 중단
if (tsconfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(tsconfig.error.messageText, "\n"));
}

// 설정한 실행 구성을 모듈의 기본값으로 공개
export default defineConfig({
    // 코드 모듈 경로 연결 설정 기록
    resolve: {
        // 기준 폴더 설정 없이 설정 파일 폴더 기준인 타입 설정 별칭의 첫 진입점을 실제 파일 경로로 연결
        alias: Object.fromEntries(
            Object.entries<readonly string[]>(tsconfig.config.compilerOptions.paths).map(
                ([alias, [entry = ""]]) => [alias, packagePath(entry)]
            )
        ),
    },
    // 테스트 실행 설정 기록
    test: {
        // 같은 테스트 데이터베이스의 작업 큐를 서로 다른 파일이 선점하지 않도록 순차 실행
        fileParallelism: !process.env.DATABASE_URL,
        // 검사할 파일 범위 기록
        include: ["apps/web/test/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
    },
});
