import { spawn } from "node:child_process";

const worker = spawn("python3", ["-m", "replay_video.runner"], {
  env: { ...process.env, PYTHONPATH: "apps/video-worker/src" },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => worker.kill(signal));
}

worker.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
