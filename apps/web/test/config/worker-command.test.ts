// 워커 실행 설정 테스트
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

describe("worker command", () => {
    it("passes isolated environments to a fake child without starting services", async () => {
        // 실제 자식 실행 없이 실행기 인자와 신호 계약 기록
        const child = { on: vi.fn(), kill: vi.fn() };
        const spawn = vi.fn(() => child);
        const argv = process.argv;
        const entry = "../../../../scripts/worker.mjs";
        const listener = vi.spyOn(process, "on").mockReturnValue(process);
        vi.doMock("node:child_process", () => ({ spawn }));
        vi.stubEnv("WORKER_PYTHON", "/fake/python");
        vi.stubEnv("WORKER_ID", "shared");
        vi.stubEnv("WORKER_TEMP_DIR", "/shared");
        vi.stubEnv("WORKER_JOB_TYPE", "wrong");
        try {
            // 두 역할의 실제 실행기 연결과 환경 덮어쓰기 확인
            for (const name of ["validate", "analyze"]) {
                vi.resetModules();
                process.argv = [process.execPath, "scripts/worker.mjs", name];
                await import(entry);
            }
            expect(spawn).toHaveBeenCalledTimes(2);
            const calls = spawn.mock.calls as unknown as [string, string[], {
                env: Record<string, string>;
            }][];
            expect(calls[0]?.[0]).toBe("/fake/python");
            const validation = calls[0]![2].env;
            const analysis = calls[1]![2].env;
            expect(validation.WORKER_JOB_TYPE).toBe("VALIDATE_VIDEO");
            expect(analysis.WORKER_JOB_TYPE).toBe("ANALYZE_VIDEO");
            expect(validation.WORKER_ID).not.toBe(analysis.WORKER_ID);
            expect(validation.WORKER_TEMP_DIR).not.toBe(analysis.WORKER_TEMP_DIR);
            expect(validation.PYTHONPATH).toContain("apps/video-worker/src");
            expect(validation.PYTHONPATH).toContain("experiments/perception/src");
            // 잘못된 실행 역할의 자식 생성 이전 거부 확인
            vi.resetModules();
            process.argv = [process.execPath, "scripts/worker.mjs", "purge"];
            await expect(import(entry)).rejects.toThrow("WORKER_ROLE-invalid");
            expect(spawn).toHaveBeenCalledTimes(2);
        } finally {
            // 전역 실행 설정과 모듈 대역 복원
            process.argv = argv;
            listener.mockRestore();
            vi.unstubAllEnvs();
            vi.doUnmock("node:child_process");
            vi.resetModules();
        }
    });

    it("isolates explicit roles from shared dotenv identities", () => {
        // 실제 순수 설정 모듈을 별도 실행기로 호출
        const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
            import { role } from './scripts/worker-role.mjs';
            const env = { WORKER_ID: 'shared', WORKER_TEMP_DIR: '/shared', WORKER_JOB_TYPE: 'wrong', WORKER_PYTHON: '/python' };
            console.log(JSON.stringify([role(env, 'validate'), role(env, 'analyze'), role(env)]));
        `], { encoding: "utf8" });
        // 역할별 환경과 기존 혼합 환경 분리 확인
        const [validation, analysis, legacy] = JSON.parse(output);
        expect(validation.WORKER_JOB_TYPE).toBe("VALIDATE_VIDEO");
        expect(analysis.WORKER_JOB_TYPE).toBe("ANALYZE_VIDEO");
        expect(validation.WORKER_ID).not.toBe(analysis.WORKER_ID);
        expect(validation.WORKER_TEMP_DIR).not.toBe(analysis.WORKER_TEMP_DIR);
        expect(validation.WORKER_ID).not.toBe("shared");
        expect(analysis.WORKER_TEMP_DIR).not.toBe("/shared");
        expect(validation.WORKER_PYTHON).toBe("/python");
        expect(legacy.WORKER_ID).toBe("shared");
        expect(legacy.WORKER_JOB_TYPE).toBe("wrong");
    });

    it("uses role overrides and rejects unknown roles before launch", () => {
        // 역할별 설정과 거부 계약을 실제 함수로 확인
        const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
            import assert from 'node:assert/strict';
            import { role } from './scripts/worker-role.mjs';
            for (const name of ['validate', 'analyze']) {
                const prefix = 'WORKER_' + name.toUpperCase();
                const env = role({ [prefix + '_ID']: ' custom ', [prefix + '_TEMP_DIR']: ' /custom ' }, name);
                assert.equal(env.WORKER_ID, 'custom');
                assert.equal(env.WORKER_TEMP_DIR, '/custom');
            }
            for (const name of ['', 'purge', 'VALIDATE_VIDEO']) assert.throws(() => role({}, name));
            console.log('ok');
        `], { encoding: "utf8" });
        expect(output.trim()).toBe("ok");
    });

    it("provides fixed role commands", () => {
        // 역할별 명령의 고정 인자 확인
        const manifest = JSON.parse(readFileSync("package.json", "utf8"));
        expect(manifest.scripts["dev:worker:validate"]).toBe(
            "node --env-file-if-exists=apps/web/.env.local scripts/worker.mjs validate"
        );
        expect(manifest.scripts["dev:worker:analyze"]).toBe(
            "node --env-file-if-exists=apps/web/.env.local scripts/worker.mjs analyze"
        );
    });

    it("loads dotenv values without sourcing shell code", () => {
        // 시험자료 시험용 응답본문 해석 결과 준비
        const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
            scripts: Record<string, string>;
        };
        // 명령 시험용 시험자료 중 선택 항목 준비
        const command = manifest.scripts["dev:worker"];

        // 명령의 환경설정 환경설정 로컬자료 작업자 포함 확인
        expect(command).toContain(
            "node --env-file-if-exists=apps/web/.env.local scripts/worker.mjs"
        );
        // 명령의 환경설정 로컬자료 미포함 확인
        expect(command).not.toContain(". apps/web/.env.local");
        // 실행기 시험용 파일읽기 결과 준비
        const launcher = readFileSync("scripts/worker.mjs", "utf8");
        // 실행기의 실행환경 환경설정 작업자 포함 확인
        expect(launcher).toContain("process.env.WORKER_PYTHON");
        // 실행기의 인식 포함 확인
        expect(launcher).toContain("experiments/perception/.venv-referee/bin/python");
        // 실행기의 기본내보내기 포함 확인
        expect(launcher).toContain("const python = configuredPython || defaultPython");
        // 실행기의 기본내보내기 포함 확인
        expect(launcher).toContain("if (!configuredPython && !existsSync(defaultPython))");
        // 실행기의 재생 영상 포함 확인
        expect(launcher).toContain('spawn(python, ["-m", "replay_video.runner"]');
        // 실행기의 지정 문자열 포함 확인
        expect(launcher).toContain("delimiter");
        // 실행기의 경로해결 저장소 영상 작업자 포함 확인
        expect(launcher).toContain('resolve(repository, "apps/video-worker/src")');
        // 실행기의 인식 포함 확인
        expect(launcher).toContain("experiments/perception/src");
        // 실행기의 작업자 오류 포함 확인
        expect(launcher).toContain('worker.on("error"');
        // 실행기의 작업자 포함 확인
        expect(launcher).toContain("worker.kill(signal)");
        // 실행기의 지정 문자열 미포함 확인
        expect(launcher).not.toContain('spawn("python3"');
    });
});
