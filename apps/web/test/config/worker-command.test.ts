// 워커 실행 설정 테스트
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("worker command", () => {
  it("loads dotenv values without sourcing shell code", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const command = manifest.scripts["dev:worker"];

    expect(command).toContain("node --env-file-if-exists=apps/web/.env.local scripts/worker.mjs");
    expect(command).not.toContain(". apps/web/.env.local");
    const launcher = readFileSync("scripts/worker.mjs", "utf8");
    expect(launcher).toContain("process.env.WORKER_PYTHON");
    expect(launcher).toContain("experiments/perception/.venv-referee/bin/python");
    expect(launcher).toContain("const python = configuredPython || defaultPython");
    expect(launcher).toContain("if (!configuredPython && !existsSync(defaultPython))");
    expect(launcher).toContain('spawn(python, ["-m", "replay_video.runner"]');
    expect(launcher).toContain("delimiter");
    expect(launcher).toContain('resolve(repository, "apps/video-worker/src")');
    expect(launcher).toContain("experiments/perception/src");
    expect(launcher).toContain('worker.on("error"');
    expect(launcher).toContain('worker.kill(signal)');
    expect(launcher).not.toContain("spawn(\"python3\"");
  });
});
