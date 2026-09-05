// 워커 실행 설정 테스트
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("worker command", () => {
  it("loads dotenv values without sourcing shell code", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const command = manifest.scripts["dev:worker"];

    expect(command).toContain("node --env-file-if-exists=apps/web/.env.local scripts/worker.mjs");
    expect(command).not.toContain(". apps/web/.env.local");
    expect(readFileSync("scripts/worker.mjs", "utf8")).toContain("spawn(\"python3\"");
  });
});
