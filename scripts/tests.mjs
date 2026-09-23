import { spawnSync } from "node:child_process";
import { python } from "./python.mjs";

// 교차 언어 시험과 동일한 실행기로 지정된 파이썬 시험 실행
const result = spawnSync(python(), ["-m", "pytest", ...process.argv.slice(2)], {
    stdio: "inherit"
});
// 실행기 누락을 시험 성공으로 처리하지 않도록 원본 오류 전달
if (result.error) throw result.error;
// 시험 실패와 신호 종료를 상위 실행 환경에 전달
process.exitCode = result.status ?? 1;
