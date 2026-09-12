import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const configuredPython = process.env.WORKER_PYTHON?.trim();
const defaultPython = resolve(repository, "experiments/perception/.venv-referee/bin/python");
const python = configuredPython || defaultPython;

if (!configuredPython && !existsSync(defaultPython)) {
  console.error(`Worker Python is missing at ${defaultPython}. Create the referee environment or set WORKER_PYTHON explicitly.`);
  process.exitCode = 1;
} else {
  const sourcePaths = [
    resolve(repository, "apps/video-worker/src"),
    resolve(repository, "experiments/perception/src"),
  ];
  if (process.env.PYTHONPATH) sourcePaths.push(process.env.PYTHONPATH);
  const worker = spawn(python, ["-m", "replay_video.runner"], {
    env: { ...process.env, PYTHONPATH: sourcePaths.join(delimiter) },
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => worker.kill(signal));
  }

  worker.on("error", (error) => {
    console.error(`Worker Python failed to start: ${error.message}`);
    process.exitCode = 1;
  });

  worker.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
