import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { python } from "../../../../scripts/python.mjs";

describe("cross-language Python environment", () => {
    it("prepares pinned Python dependencies before CI assertions", () => {
        // 실제 지속 통합 설정을 읽어 실행 환경 준비 순서 확인
        const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
        // 파이썬 준비 단계와 검증된 패치 판본 고정 확인
        expect(workflow).toContain("actions/setup-python@");
        expect(workflow).toContain("python-version: '3.11.9'");
        // 캐시 설정만 존재하는 경우와 실제 의존성 설치를 구분
        const installation = '"$TEST_PYTHON" -m pip install -r apps/video-worker/requirements-test.txt';
        expect(workflow).toContain(installation);
        expect(workflow.indexOf(installation)).toBeLessThan(workflow.indexOf("npm run check"));
        // 준비한 실행기의 전달과 파이썬 시험 단계 확인
        expect(workflow).toContain("TEST_PYTHON: ${{ steps.python.outputs.python-path }}");
        expect(workflow).toContain("npm run test:video");
        // 직접 및 전이 의존성을 범위 지정 없이 고정했는지 확인
        const requirements = readFileSync("apps/video-worker/requirements-test.txt", "utf8")
            .split("\n").filter((line) => line.trim() && !line.startsWith("#"));
        expect(requirements.some((line) => line.startsWith("pytest=="))).toBe(true);
        expect(requirements.every((line) => /^[A-Za-z0-9-]+==\d+(\.\d+)+$/.test(line))).toBe(true);
    });

    it("fails instead of falling back when the explicit executable is missing", () => {
        // 존재하지 않는 명시 경로를 실제 시험 실행기에 전달
        const result = spawnSync(process.execPath, ["scripts/tests.mjs", "--version"], {
            env: { ...process.env, TEST_PYTHON: resolve("missing-python/bin/python") },
            encoding: "utf8"
        });
        // 로컬 기본 파이썬으로 대체하지 않고 실패 코드 전달 확인
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("ENOENT");
    });

    it("loads the shared frame without installed site packages", () => {
        // 외부 패키지 검색을 차단한 실제 파이썬 프로세스 실행
        const result = spawnSync(python(), ["-S", "-c", `
import json
import sys
from fixtures.interaction import frame
from replay_video.domain.interactions import InteractionObservations
engine = InteractionObservations('a' * 64)
engine.update(frame(), 's1')
row = engine.update(frame(1000), 's1')[0]
assert 'pytest' not in sys.modules
assert 'test_interactions' not in sys.modules
print(json.dumps(row))
`], {
            // 운영 관측 코드와 공통 시험자료 위치만 검색 경로로 전달
            env: {
                ...process.env,
                PYTHONPATH: ["apps/video-worker/src", "apps/video-worker/tests"]
                    .map((path) => resolve(path)).join(delimiter)
            },
            encoding: "utf8"
        });
        // 시험자료 준비부터 실제 생산자 실행까지 성공 확인
        expect(result.status, result.stderr).toBe(0);
        // 고정 정답 대신 실제 생산자의 측정과 미확인 접촉 확인
        const row = JSON.parse(result.stdout);
        expect(row.measurements.centerDistance.state).toBe("MEASURED");
        expect(row.contact.value).toBeNull();
    });

    it("shares explicit interpreter selection with the Python test launcher", () => {
        // 별도 노드 프로세스에서 공통 실행기 선택 계약 확인
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { python } from './scripts/python.mjs';
assert.equal(python({}), 'python3');
assert.equal(python({TEST_PYTHON: '/tmp/test env/bin/python'}), '/tmp/test env/bin/python');
assert.throws(() => python({TEST_PYTHON: ' '}), /TEST_PYTHON/);
`], { encoding: "utf8" });
        // 지정 경로 보존과 빈 설정 거부 확인
        expect(result.status, result.stderr).toBe(0);
    });
});
