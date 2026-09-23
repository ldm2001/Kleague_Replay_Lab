import { spawnSync } from "node:child_process";
import { python } from "./python.mjs";

// 로컬 시험 기록에도 실제 영상 도구의 판본과 빌드 설정 출력
for (const tool of ["ffmpeg", "ffprobe"]) {
    // 도구 조회에도 제한 시간을 적용해 시험 시작 정체 방지
    const version = spawnSync(tool, ["-version"], { encoding: "utf8", timeout: 10_000 });
    // 실행 불가 또는 판본 조회 실패를 숨기지 않고 중단
    if (version.error) throw version.error;
    if (version.status !== 0) throw new Error(`${tool}-version-failed`);
    // 도구별 전체 판본과 빌드 설정을 시험 로그에 기록
    console.log(version.stdout.trim());
}

// 교차 언어 시험과 동일한 실행기로 지정된 파이썬 시험 실행
const result = spawnSync(python(), ["-m", "pytest", ...process.argv.slice(2)], {
    stdio: "inherit"
});
// 실행기 누락을 시험 성공으로 처리하지 않도록 원본 오류 전달
if (result.error) throw result.error;
// 시험 실패와 신호 종료를 상위 실행 환경에 전달
process.exitCode = result.status ?? 1;
