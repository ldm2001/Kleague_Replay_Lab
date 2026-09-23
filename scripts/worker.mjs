// 별도 프로세스 실행 도구 가져오기
import { spawn } from "node:child_process";
// 파일 접근 도구 가져오기
import { existsSync } from "node:fs";
// 파일 경로 도구 가져오기
import { delimiter, resolve } from "node:path";
// 주소와 파일 경로 변환 도구 가져오기
import { fileURLToPath } from "node:url";
import { role } from "./worker-role.mjs";

// 실행기와 자식 생성 전에 명시 역할의 유효성 확인
const environment = role(process.env, process.argv[2]);
// 저장소의 절대 경로 확인
const repository = fileURLToPath(new URL("..", import.meta.url));
// 설정으로 지정한 실행기 경로 확인
const configuredPython = process.env.WORKER_PYTHON?.trim();
// 전용 환경의 기본 실행기 경로 확인
const defaultPython = resolve(repository, "experiments/perception/.venv-referee/bin/python");
// 작업에 사용할 실행기 계산
const python = configuredPython || defaultPython;

// 설정으로 지정한 실행기 경로 및 전용 환경의 기본 실행기 경로의 조건에 따라 처리 분기
if (!configuredPython && !existsSync(defaultPython)) {
    // 실패 내용을 오류 출력으로 전달
    console.error(
        `Worker Python is missing at ${defaultPython}. Create the referee environment or set WORKER_PYTHON explicitly.`
    );
    // 상위 실행기가 받을 종료 코드 갱신
    process.exitCode = 1;
} else {
    // 작업자가 읽을 소스 폴더 목록 구성
    const sourcePaths = [
        resolve(repository, "apps/video-worker/src"),
        resolve(repository, "experiments/perception/src")
    ];
    // 실행 환경 변수의 조건에 따라 처리 분기
    if (process.env.PYTHONPATH) sourcePaths.push(process.env.PYTHONPATH);
    // 별도 프로세스로 실행한 작업자 확인
    const worker = spawn(python, ["-m", "replay_video.runner"], {
        // 실행 환경 변수 기록
        env: { ...environment, PYTHONPATH: sourcePaths.join(delimiter) },
        // 하위 프로세스의 입출력 연결 방식 기록
        stdio: "inherit"
    });

    // 작업자에게 전달할 중단과 종료 신호를 각각 등록
    for (const signal of ["SIGINT", "SIGTERM"]) {
        // 종료 신호를 작업자 프로세스에 전달하도록 등록
        process.on(signal, () => worker.kill(signal));
    }

    // 작업자의 실패와 종료 상태를 부모 프로세스에 연결
    worker.on("error", (error) => {
        // 실패 내용을 오류 출력으로 전달
        console.error(`Worker Python failed to start: ${error.message}`);
        // 상위 실행기가 받을 종료 코드 갱신
        process.exitCode = 1;
    });

    // 작업자의 실패와 종료 상태를 부모 프로세스에 연결
    worker.on("exit", (code) => {
        // 상위 실행기가 받을 종료 코드 갱신
        process.exitCode = code ?? 1;
    });
}
