import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { entry, query, watch, type Host, type Result } from "../../../../scripts/watch.mjs";

// 문서에 적은 임대 조회문의 기대 문장
const LEASE = "select count(*), count(*) filter (where lease_until <= '2026-11-12T00:00:00.000Z'::timestamptz), coalesce(to_char((min(heartbeat_at) filter (where lease_until <= '2026-11-12T00:00:00.000Z'::timestamptz)) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '-') from processing_jobs where status = 'PROCESSING'";

// 시험용 상태 파일 경로
const STATE = "/state/watch.json";

// 시험용 표시 파일 경로
const MARKER = "/state/quiet";

// 모든 점검에 필요한 두 인자
const BASE = ["--state", STATE, "--marker", MARKER];

// 가짜 실행 환경이 받은 명령 호출
interface Call {
    file: string;
    args: string[];
    limit: number;
}

// 가짜 파일의 식별 번호와 내용
interface File {
    inode: number;
    data: Buffer;
}

// 명령과 파일과 시계를 대신하는 가짜 실행 환경 생성
const fake = () => {
    // 경로별 가짜 파일
    const files = new Map<string, File>();
    // 받은 명령 호출
    const calls: Call[] = [];
    // 표준 출력 줄
    const lines: string[] = [];
    // 표준 오류 줄
    const errors: string[] = [];
    // 출력과 저장의 순서
    const order: string[] = [];
    // 다음 가짜 파일 식별 번호
    let serial = 100;
    // 시험이 조작하는 값과 스크립트에 넘길 실행 환경
    const box = {
        files,
        calls,
        lines,
        errors,
        order,
        // 현지 시각 2026-11-12 09:00:00의 가짜 시계
        clock: new Date(2026, 10, 12, 9, 0, 0),
        // 명령 호출별 응답
        reply: (_call: Call): Result => ({ code: 0, out: "", err: "" }),
        // 새 식별 번호의 파일 생성
        put(path: string, text: string) {
            files.set(path, { inode: serial++, data: Buffer.from(text) });
        },
        // 같은 식별 번호의 파일 뒤에 덧붙임
        add(path: string, text: string) {
            // 덧붙일 기존 파일
            const file = files.get(path);
            if (!file) throw new Error("missing");
            file.data = Buffer.concat([file.data, Buffer.from(text)]);
        },
        // 저장된 상태 파일 읽음
        saved(): Record<string, unknown> {
            return JSON.parse(files.get(STATE)?.data.toString("utf8") ?? "null");
        },
        host: {
            run(file, args, limit): Result {
                // 호출 기록
                const call = { file, args, limit };
                calls.push(call);
                return box.reply(call);
            },
            stat(path) {
                // 조회한 파일
                const file = files.get(path);
                return file ? { inode: file.inode, size: file.data.length } : null;
            },
            read(path) {
                return files.get(path)?.data.toString("utf8") ?? null;
            },
            part(path, start, end) {
                // 읽을 파일
                const file = files.get(path);
                if (!file) throw new Error("missing");
                return file.data.subarray(start, end);
            },
            save(path, text) {
                order.push("save");
                files.set(path, { inode: serial++, data: Buffer.from(text) });
            },
            now(): Date {
                return box.clock;
            },
            print(line) {
                order.push("print");
                lines.push(line);
            },
            warn(line) {
                errors.push(line);
            }
        } satisfies Host
    };
    return box;
};

// 알림 없이 한 회차를 실행하고 종료 코드와 새로 나온 줄 반환
const round = (box: ReturnType<typeof fake>, ...args: string[]) => {
    // 이번 회차 전의 줄 수
    const from = box.lines.length;
    // 종료 코드
    const code = watch([...BASE, "--silent", ...args], box.host);
    return { code, lines: box.lines.slice(from) };
};

// 문서에 적은 inspect 출력 형식
const FORMAT = "{{.Id}}|{{.Created}}|{{.State.Status}}|{{with index .State \"Health\"}}{{.Status}}{{else}}-{{end}}|{{.RestartCount}}";

// 시험용 컨테이너 Id 두 개
const FIRST = "1a".repeat(32);
const SECOND = "2b".repeat(32);

// 시험용 기준값 파일 경로
const ORIGIN = "/state/infra-session/baseline";

// 컨테이너 상태 한 줄의 inspect 출력 생성
const shown = (status: string, health: string, restarts: number, id = FIRST, created = "2026-11-10T01:02:03.123456789Z") =>
    `${id}|${created}|${status}|${health}|${restarts}\n`;

// 인프라 세션이 쓰는 형식의 기준값 파일 내용 생성
const origin = (recorded: string, name: string, restarts: string) => [
    `recordedAt|${recorded}`,
    `/${name}|running|healthy|unless-stopped|${restarts}|2026-11-11T02:59:40.123456789Z|0001-01-01T00:00:00Z|0|local|postgres:16-alpine|sha256:${"3c".repeat(32)}|local_data `,
    `/other|running|-|unless-stopped|7|2026-11-11T02:59:41.123456789Z|0001-01-01T00:00:00Z|0|local|minio:latest|sha256:${"4d".repeat(32)}|local_store `,
    ""
].join("\n");

// 컨테이너 이름별 inspect 응답을 가짜 실행 환경에 연결
const docker = (box: ReturnType<typeof fake>, table: Record<string, string | Result>) => {
    box.reply = (call) => {
        // inspect가 아닌 호출은 명령 없음으로 응답
        if (call.file !== "docker" || call.args[0] !== "inspect") return { code: 127, out: "", err: "unexpected\n" };
        // 마지막 인자의 컨테이너 이름
        const name = call.args.at(-1) ?? "";
        // 그 컨테이너의 응답
        const answer = table[name];
        if (answer === undefined) return { code: 1, out: "", err: `Error: No such container: ${name}\n` };
        return typeof answer === "string" ? { code: 0, out: answer, err: "" } : answer;
    };
    return table;
};

// 상태 파일 없이 시작한 첫 점검의 줄
const BEGIN = "2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작";

// 시험용 웹 로그 경로
const LOG = "/logs/web.log";

// 웹 로그와 준비된 웹 서비스의 인자
const WEB = ["--log", `web=${LOG}`, "--service", "web=1:1:1:5", "--grace", "95"];

// 웹 로그와 pid 기록이 없는 웹 서비스의 인자
const DOWN = ["--log", `web=${LOG}`, "--service", "web=0:0:0:-", "--grace", "95"];

// 실행기 필터 형식의 500 선점 줄 두 개
const FAIL = "2026-11-12 08:59:30  POST /api/internal/jobs/claim 500 in 12ms";
const NEXT = "2026-11-12 08:59:31  POST /api/internal/jobs/claim 500 in 9ms";

// 실행기 필터 형식의 200 선점 줄
const DONE = "2026-11-12 09:01:00  POST /api/internal/jobs/claim 200 in 31ms";

// 실행기 필터의 유휴 요약 줄과 종료 요약 줄
const IDLE = "2026-11-12 09:05:00 [services] idle claim 204 x60 in 300s";
const LAST = "2026-11-12 09:06:00 [services] final claim 204 x12 in 60s";

// 첫 500 줄을 알리는 claim 이상 줄
const ALARM = "2026-11-12 09:00:00 ALERT claim web 2026-11-12 08:59:30  POST /api/internal/jobs/claim 500 in 12ms";

// claim 회복 줄
const RELIEF = "2026-11-12 09:00:00 RECOVER claim web 500 없는 읽기 · 회복 증거 확인";

// 웹 로그를 두고 첫 점검으로 읽기 위치를 잡은 가짜 실행 환경 생성
const logged = (text = "") => {
    // 가짜 실행 환경
    const box = fake();
    box.put(LOG, text);
    round(box, ...WEB);
    return box;
};

// 같은 식별 번호의 파일 내용을 바꿈
const swap = (box: ReturnType<typeof fake>, path: string, text: string) => {
    // 내용을 바꿀 기존 파일
    const file = box.files.get(path);
    if (!file) throw new Error("missing");
    file.data = Buffer.from(text);
};

// 시험용 DB 인자
const DB = ["--db-container", "rlprobe-db", "--db-user", "replay", "--db-name", "replay_lab"];

// 읽기 전용과 문장 시간 제한을 강제하는 연결 설정의 기대 문장
const GUARD = "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000";

// DB 조회 응답을 가짜 실행 환경에 연결
const psql = (box: ReturnType<typeof fake>, answer: string | Result) => {
    box.reply = (call) => {
        // exec가 아닌 호출은 명령 없음으로 응답
        if (call.file !== "docker" || call.args[0] !== "exec") return { code: 127, out: "", err: "unexpected\n" };
        return typeof answer === "string" ? { code: 0, out: answer, err: "" } : answer;
    };
};

// 그룹이 없는 검증 Worker의 이상 줄
const GONE = "2026-11-12 09:00:00 ALERT service validate 기록 있음 · 그룹 없음";

// 서비스 관측값만 넘긴 한 회차의 줄 반환
const glance = (box: ReturnType<typeof fake>, ...values: string[]) =>
    round(box, ...values.flatMap((value) => ["--service", value]), "--grace", "95").lines;

describe("watch script entry and query", () => {
    it("builds the lease query around the host time", () => {
        // 호스트 시각을 두 비교 자리에 넣은 조회문 확인
        expect(query("2026-11-12T00:00:00.000Z")).toBe(LEASE);
        // 초 단위 시각 허용 확인
        expect(query("2000-01-01T00:00:00Z")).toContain("lease_until <= '2000-01-01T00:00:00Z'::timestamptz");
    });

    it("refuses a host time that is not a UTC instant", () => {
        // 현지 시각 형식 거부 확인
        expect(() => query("2026-11-12 09:00:00")).toThrow();
        // 조회문을 끊는 문자가 든 값 거부 확인
        expect(() => query("2026-11-12T00:00:00Z'; delete from processing_jobs; --")).toThrow();
        // 빈 값 거부 확인
        expect(() => query("")).toThrow();
    });

    it("treats a missing script path as an import", () => {
        // 실행 경로가 없는 경우 확인
        expect(entry("file:///nowhere/watch.mjs", undefined)).toBe(false);
        // 실제 경로를 찾을 수 없는 경우 확인
        expect(entry("file:///nowhere/watch.mjs", "/nowhere/watch.mjs")).toBe(false);
    });

    it("does not run a check when imported", () => {
        // 가져오기만 하는 별도 프로세스 실행
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { watch } from './scripts/watch.mjs';
console.log(typeof watch);
`], { encoding: "utf8" });

        // 인자 해석 없이 정상 종료함 확인
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("function\n");
    });

    it("parses arguments when run directly", () => {
        // 알 수 없는 인자를 준 직접 실행
        const result = spawnSync(process.execPath, ["scripts/watch.mjs", "--bogus"], { encoding: "utf8" });

        // 사용법 오류 종료 코드와 빈 표준 출력 확인
        expect(result.status, result.stderr).toBe(2);
        expect(result.stdout).toBe("");
    });

    it("parses arguments when run through a linked path", () => {
        // 링크를 둘 임시 폴더
        const folder = mkdtempSync(join(tmpdir(), "watch-link-"));
        try {
            // 원본을 가리키는 링크 생성
            symlinkSync(resolve("scripts/watch.mjs"), join(folder, "linked.mjs"));
            // 링크 경로로 직접 실행
            const result = spawnSync(process.execPath, [join(folder, "linked.mjs"), "--bogus"], { encoding: "utf8" });

            // 링크를 거쳐도 인자 해석이 실행됨 확인
            expect(result.status, result.stderr).toBe(2);
        } finally {
            // 임시 폴더 삭제
            rmSync(folder, { recursive: true, force: true });
        }
    });
});

describe("watch script arguments", () => {
    it.each<[string, string[]]>([
        ["an unknown flag", [...BASE, "--bogus"]],
        ["a missing state file", ["--marker", MARKER]],
        ["a missing marker file", ["--state", STATE]],
        ["a flag without its value", ["--state", STATE, "--marker"]],
        ["a flag used as a value", ["--state", "--marker", MARKER]],
        ["an empty value", ["--state", "", "--marker", MARKER]],
        ["a repeated state file", [...BASE, "--state", STATE]],
        ["a repeated silent flag", [...BASE, "--silent", "--silent"]],
        ["a repeated container name", [...BASE, "--container", "a", "--container", "a"]],
        ["a container name with a slash", [...BASE, "--container", "a/b"]],
        ["a container name starting with a dash", [...BASE, "--container", "-a"]],
        ["only two of the three DB arguments", [...BASE, "--db-container", "pg", "--db-user", "replay"]],
        ["a DB user with a blank", [...BASE, "--db-container", "pg", "--db-user", "re play", "--db-name", "replay_lab"]],
        ["a DB name with a semicolon", [...BASE, "--db-container", "pg", "--db-user", "replay", "--db-name", "replay;lab"]],
        ["a service without the grace value", [...BASE, "--service", "web=1:1:1:5"]],
        ["a negative grace value", [...BASE, "--service", "web=1:1:1:5", "--grace", "-1"]],
        ["a fractional grace value", [...BASE, "--service", "web=1:1:1:5", "--grace", "9.5"]],
        ["a repeated service name", [...BASE, "--service", "web=1:1:1:5", "--service", "web=1:1:1:6", "--grace", "95"]],
        ["an upper case service name", [...BASE, "--service", "Web=1:1:1:5", "--grace", "95"]],
        ["a service value with three fields", [...BASE, "--service", "web=1:1:1", "--grace", "95"]],
        ["a service field other than 0 or 1", [...BASE, "--service", "web=2:1:1:5", "--grace", "95"]],
        ["a recorded service without its age", [...BASE, "--service", "web=1:1:1:-", "--grace", "95"]],
        ["an unrecorded service with an age", [...BASE, "--service", "web=0:0:0:5", "--grace", "95"]],
        ["a ready service without a group", [...BASE, "--service", "web=1:0:1:5", "--grace", "95"]],
        ["a group without a record", [...BASE, "--service", "web=0:1:0:-", "--grace", "95"]],
        ["a log whose service is not observed", [...BASE, "--log", "web=/logs/web.log", "--service", "validate=1:1:1:5", "--grace", "95"]],
        ["a log without a path", [...BASE, "--log", "web=", "--service", "web=1:1:1:5", "--grace", "95"]],
        ["a repeated log", [...BASE, "--log", "web=/a.log", "--log", "web=/b.log", "--service", "web=1:1:1:5", "--grace", "95"]],
        ["a report mixed with a check flag", ["--report", ...BASE, "--silent"]],
        ["a report mixed with a container", ["--report", ...BASE, "--container", "a"]]
    ])("rejects %s as a usage error", (_name, argv) => {
        // 가짜 실행 환경
        const box = fake();

        // 사용법 오류 종료 코드와 안내 출력 확인
        expect(watch(argv, box.host)).toBe(2);
        expect(box.errors).not.toEqual([]);
        // 점검과 출력과 저장이 없음 확인
        expect(box.calls).toEqual([]);
        expect(box.order).toEqual([]);
    });

    it("accepts every documented argument together", () => {
        // 가짜 실행 환경
        const box = fake();
        // 문서의 호출 형식에 있는 모든 인자
        const argv = [
            ...BASE,
            "--container", "rlprobe-a",
            "--container", "rlprobe-b",
            "--baseline", "/state/baseline",
            "--log", "web=/logs/web.log",
            "--service", "web=1:1:1:5",
            "--service", "validate=1:1:0:20",
            "--service", "analyze=0:0:0:-",
            "--grace", "95",
            "--db-container", "rlprobe-db",
            "--db-user", "replay",
            "--db-name", "replay_lab",
            "--fresh",
            "--silent"
        ];

        // 이상이 있어도 점검 완료 종료 코드 확인
        expect(watch(argv, box.host)).toBe(0);
        expect(box.errors).toEqual([]);
    });
});

describe("watch script state file", () => {
    it("starts fresh with a note when no state file exists", () => {
        // 가짜 실행 환경
        const box = fake();
        // 첫 회차
        const first = round(box);

        // 새로 시작 안내 한 줄 확인
        expect(first.code).toBe(0);
        expect(first.lines).toEqual(["2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작"]);
        // 판 번호와 점검 시각 저장 확인
        expect(box.saved().version).toBe(1);
        expect(box.saved().checkedAt).toBe(box.clock.toISOString());
        // 줄 출력 뒤 저장 순서 확인
        expect(box.order).toEqual(["print", "save"]);
    });

    it("stays silent once the saved state is read back", () => {
        // 가짜 실행 환경
        const box = fake();
        round(box);

        // 둘째 회차에는 줄 없음 확인
        expect(round(box).lines).toEqual([]);
    });

    it.each<[string, string]>([
        ["broken text", "{ broken"],
        ["a missing field", JSON.stringify({ version: 1 })],
        ["a field of the wrong kind", JSON.stringify({ version: 1, checkedAt: null, quiet: false, signals: 5 })]
    ])("starts fresh with a note when the state file holds %s", (_name, text) => {
        // 읽을 수 없는 상태 파일을 둔 가짜 실행 환경
        const box = fake();
        box.put(STATE, text);

        // 새로 시작 안내와 다음 회차의 정상 동작 확인
        expect(round(box).lines).toEqual(["2026-11-12 09:00:00 NOTE state - 상태 파일 읽을 수 없음 · 새로 시작"]);
        expect(round(box).lines).toEqual([]);
    });

    it("starts fresh with a note when the state version differs", () => {
        // 다른 판 번호의 상태 파일을 둔 가짜 실행 환경
        const box = fake();
        round(box);
        box.put(STATE, JSON.stringify({ ...box.saved(), version: 0 }));

        // 판 번호 안내 확인
        expect(round(box).lines).toEqual(["2026-11-12 09:00:00 NOTE state - 상태 파일 판 번호 다름 · 새로 시작"]);
        expect(box.saved().version).toBe(1);
    });

    it("reports no record and writes nothing when no state file exists", () => {
        // 가짜 실행 환경
        const box = fake();

        // 점검 기록 없음과 표시 파일 존재만 출력 확인
        expect(watch(["--report", ...BASE], box.host)).toBe(0);
        expect(box.lines).toEqual(["점검 기록 없음", "표시 파일 없음"]);
        // 저장과 명령 실행 없음 확인
        expect(box.order).toEqual(["print", "print"]);
        expect(box.files.has(STATE)).toBe(false);
        expect(box.calls).toEqual([]);
    });

    it("reports no record when the state file cannot be used", () => {
        // 다른 판 번호의 상태 파일과 표시 파일을 둔 가짜 실행 환경
        const box = fake();
        box.put(STATE, JSON.stringify({ version: 0 }));
        box.put(MARKER, "");

        // 점검 기록 없음과 표시 파일 있음 확인
        expect(watch(["--report", ...BASE], box.host)).toBe(0);
        expect(box.lines).toEqual(["점검 기록 없음", "표시 파일 있음"]);
        // 상태 파일을 고치지 않음 확인
        expect(box.files.get(STATE)?.data.toString("utf8")).toBe(JSON.stringify({ version: 0 }));
    });
});

describe("watch script container signal", () => {
    it("inspects each container once with a fixed argument list and a ten second limit", () => {
        // 정상 컨테이너 둘을 둔 가짜 실행 환경
        const box = fake();
        docker(box, { "rlprobe-a": shown("running", "healthy", 0), "rlprobe-b": shown("running", "-", 0, SECOND) });
        round(box, "--container", "rlprobe-a", "--container", "rlprobe-b");

        // 셸을 거치지 않는 인자 배열과 시간 제한 확인
        expect(box.calls).toEqual([
            { file: "docker", args: ["inspect", "--type", "container", "-f", FORMAT, "rlprobe-a"], limit: 10_000 },
            { file: "docker", args: ["inspect", "--type", "container", "-f", FORMAT, "rlprobe-b"], limit: 10_000 }
        ]);
    });

    it.each<[string, string, string | null]>([
        ["paused", "unhealthy", "Status paused · Health unhealthy"],
        ["paused", "healthy", "Status paused · Health healthy"],
        ["exited", "unhealthy", "Status exited · Health unhealthy"],
        ["exited", "-", "Status exited · Health -"],
        ["restarting", "-", "Status restarting · Health -"],
        ["created", "-", "Status created · Health -"],
        ["dead", "-", "Status dead · Health -"],
        ["running", "unhealthy", "Status running · Health unhealthy"],
        ["running", "starting", null],
        ["running", "healthy", null],
        ["running", "-", null]
    ])("judges Status %s with Health %s after a normal check", (status, health, text) => {
        // 정상으로 한 번 점검한 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "healthy", 0) });
        round(box, "--container", "rlprobe-a");
        table["rlprobe-a"] = shown(status, health, 0);

        // 이상에 들어설 때만 경보 줄 한 줄 확인
        expect(round(box, "--container", "rlprobe-a").lines).toEqual(
            text === null ? [] : [`2026-11-12 09:00:00 ALERT container rlprobe-a ${text}`]
        );
    });

    it("alerts once while a problem lasts and recovers once", () => {
        // 정지한 컨테이너를 둔 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "healthy", 0) });
        round(box, "--container", "rlprobe-a");
        table["rlprobe-a"] = shown("exited", "unhealthy", 0);

        // 이상에 들어선 회차의 경보와 지속 중 무음 확인
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 ALERT container rlprobe-a Status exited · Health unhealthy"
        ]);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([]);

        // 벗어난 회차의 회복 줄과 그 뒤 무음 확인
        table["rlprobe-a"] = shown("running", "healthy", 0);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 RECOVER container rlprobe-a Status running · Health healthy"
        ]);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([]);
    });

    it("keeps the alert while a restarted container is still starting", () => {
        // 정지 뒤 다시 시작한 컨테이너를 둔 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("exited", "unhealthy", 0) });
        expect(round(box, "--container", "rlprobe-a").lines).toContain(
            "2026-11-12 09:00:00 ALERT container rlprobe-a Status exited · Health unhealthy"
        );

        // 기동 중 건강 검사에서는 회복 줄 없음 확인
        table["rlprobe-a"] = shown("running", "starting", 0);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([]);

        // 건강 검사 통과 뒤 회복 줄 확인
        table["rlprobe-a"] = shown("running", "healthy", 0);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 RECOVER container rlprobe-a Status running · Health healthy"
        ]);
    });

    it.each<[string, string | Result, string]>([
        ["a missing container", { code: 1, out: "", err: "Error: No such container: rlprobe-a\n" }, "종료 코드 1 · Error: No such container: rlprobe-a"],
        ["a command that cannot run or times out", { code: null, out: "", err: "" }, "실행 불가 또는 시간 초과"],
        ["a failure without an error text", { code: 127, out: "", err: "" }, "종료 코드 127"],
        ["control characters in the error text", { code: 1, out: "", err: "\u001b[31mdenied\u0007\u001b[0m\nsecond\n" }, "종료 코드 1 · [31mdenied[0m"],
        ["four fields", `${FIRST}|2026-11-10T01:02:03.123456789Z|running|healthy\n`, "형식 불일치"],
        ["six fields", `${FIRST}|2026-11-10T01:02:03.123456789Z|running|healthy|0|extra\n`, "형식 불일치"],
        ["two lines", shown("running", "healthy", 0) + shown("running", "healthy", 0), "형식 불일치"],
        ["an empty output", "", "형식 불일치"],
        ["an unknown Health value", shown("running", "none", 0), "형식 불일치"],
        ["a short Id", shown("running", "healthy", 0, "1a2b"), "형식 불일치"],
        ["a creation time that is not a UTC instant", shown("running", "healthy", 0, FIRST, "yesterday"), "형식 불일치"],
        ["a RestartCount that is not a number", `${FIRST}|2026-11-10T01:02:03.123456789Z|running|healthy|many\n`, "형식 불일치"]
    ])("treats %s as an inspect failure", (_name, answer, text) => {
        // 실패하는 inspect를 둔 가짜 실행 환경
        const box = fake();
        docker(box, { "rlprobe-a": answer });

        // inspect 실패 경보와 상태 안내만 있음 확인
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작",
            `2026-11-12 09:00:00 ALERT container rlprobe-a inspect 실패 · ${text}`
        ]);
    });

    it("judges each container on its own", () => {
        // 정상 하나와 정지 하나를 둔 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "healthy", 0), "rlprobe-b": shown("running", "-", 0, SECOND) });
        round(box, "--container", "rlprobe-a", "--container", "rlprobe-b");
        table["rlprobe-b"] = shown("exited", "-", 0, SECOND);

        // 정지한 컨테이너만 경보 확인
        expect(round(box, "--container", "rlprobe-a", "--container", "rlprobe-b").lines).toEqual([
            "2026-11-12 09:00:00 ALERT container rlprobe-b Status exited · Health -"
        ]);
    });
});

describe("watch script restart signal", () => {
    it("notes the first observed count when no baseline exists and stays silent while it holds", () => {
        // 재시작 2회의 컨테이너를 처음 보는 가짜 실행 환경
        const box = fake();
        docker(box, { "rlprobe-a": shown("running", "healthy", 2) });

        // 첫 관측값 안내와 경보 없음 확인
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작",
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 2 · 첫 관측값"
        ]);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([]);
    });

    it("alerts once for every check that sees the count grow", () => {
        // 재시작 횟수가 두 번 늘어나는 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "-", 0) });
        round(box, "--container", "rlprobe-a");

        // 첫 증가의 경보 한 줄 확인
        table["rlprobe-a"] = shown("running", "-", 1);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 0 · 관측 1"
        ]);
        // 늘지 않은 회차의 무음 확인
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([]);

        // 폭과 상관없이 다음 증가의 경보 한 줄 확인
        table["rlprobe-a"] = shown("running", "-", 4);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 1 · 관측 4"
        ]);
    });

    it("compares a replaced container against zero", () => {
        // 같은 이름의 컨테이너가 새 Id로 바뀌는 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "-", 3) });
        round(box, "--container", "rlprobe-a");

        // 교체 안내와 0 기준 경보 확인
        table["rlprobe-a"] = shown("running", "-", 2, SECOND);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 0 · 컨테이너 교체",
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 0 · 관측 2"
        ]);

        // 재시작이 없는 교체는 안내만 확인
        table["rlprobe-a"] = shown("running", "-", 0, FIRST);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 0 · 컨테이너 교체"
        ]);
    });

    it.each<[string, string, number, string[]]>([
        ["the recorded count when it has not grown", "2026-11-10T01:02:03.123456789Z", 3, []],
        ["the recorded count when it has grown", "2026-11-10T01:02:03.123456789Z", 5, [
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 3 · 관측 5"
        ]],
        ["the recorded count when the container was created within the recorded second", "2026-11-11T03:00:00.999999999Z", 3, []],
        ["zero when the container was created after the record", "2026-11-11T03:00:01.000000000Z", 3, [
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 0 · 기준값 기록 뒤 재생성",
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 0 · 관측 3"
        ]],
        ["zero without an alert when a container created after the record has not restarted", "2026-11-12T00:00:00.000000000Z", 0, [
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 0 · 기준값 기록 뒤 재생성"
        ]]
    ])("starts from %s", (_name, created, restarts, lines) => {
        // 재시작 3회를 적은 기준값 파일을 둔 가짜 실행 환경
        const box = fake();
        box.put(ORIGIN, origin("2026-11-11T03:00:00Z", "rlprobe-a", "3"));
        docker(box, { "rlprobe-a": shown("running", "healthy", restarts, FIRST, created) });

        // 기준 선택에 따른 줄 확인
        expect(round(box, "--container", "rlprobe-a", "--baseline", ORIGIN).lines).toEqual([
            "2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작",
            ...lines
        ]);
    });

    it.each<[string, string | null]>([
        ["is missing", null],
        ["has no line for the container", origin("2026-11-11T03:00:00Z", "elsewhere", "0")],
        ["has a broken first line", origin("yesterday", "rlprobe-a", "0")],
        ["has a local time in its first line", origin("2026-11-11 03:00:00", "rlprobe-a", "0")],
        ["has a count that is not a number", origin("2026-11-11T03:00:00Z", "rlprobe-a", "many")],
        ["has a short line for the container", "recordedAt|2026-11-11T03:00:00Z\n/rlprobe-a|running|healthy|no\n"]
    ])("starts from the first observed count when the baseline file %s", (_name, text) => {
        // 쓸 수 없는 기준값 파일을 둔 가짜 실행 환경
        const box = fake();
        if (text !== null) box.put(ORIGIN, text);
        docker(box, { "rlprobe-a": shown("running", "healthy", 4) });

        // 첫 관측값 안내와 경보 없음 확인
        expect(round(box, "--container", "rlprobe-a", "--baseline", ORIGIN).lines).toEqual([
            "2026-11-12 09:00:00 NOTE state - 상태 파일 없음 · 새로 시작",
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 4 · 첫 관측값"
        ]);
    });

    it("reads the baseline file only while it holds no count of its own", () => {
        // 기준값 파일로 시작한 가짜 실행 환경
        const box = fake();
        box.put(ORIGIN, origin("2026-11-11T03:00:00Z", "rlprobe-a", "3"));
        docker(box, { "rlprobe-a": shown("running", "healthy", 3) });
        round(box, "--container", "rlprobe-a", "--baseline", ORIGIN);

        // 기준값 파일이 바뀌어도 마지막으로 본 값과 비교함 확인
        box.put(ORIGIN, origin("2026-11-11T03:00:00Z", "rlprobe-a", "0"));
        expect(round(box, "--container", "rlprobe-a", "--baseline", ORIGIN).lines).toEqual([]);
    });

    it("compares against zero again when the count goes down", () => {
        // 재시작 5회를 본 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "-", 5) });
        round(box, "--container", "rlprobe-a");

        // 감소 안내 뒤 0 기준 경보 확인
        table["rlprobe-a"] = shown("running", "-", 2);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 5 · 관측 2 · 감소 뒤 0과 비교",
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 0 · 관측 2"
        ]);

        // 0으로 돌아간 감소는 안내만 확인
        table["rlprobe-a"] = shown("running", "-", 0);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 NOTE restart rlprobe-a 기준 2 · 관측 0 · 감소 뒤 0과 비교"
        ]);
    });

    it("skips the comparison and keeps the stored count when inspect fails", () => {
        // 재시작 0회를 본 가짜 실행 환경
        const box = fake();
        const table = docker(box, { "rlprobe-a": shown("running", "-", 0) });
        round(box, "--container", "rlprobe-a");

        // 실패한 회차에는 컨테이너 경보만 있음 확인
        table["rlprobe-a"] = { code: null, out: "", err: "" };
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 ALERT container rlprobe-a inspect 실패 · 실행 불가 또는 시간 초과"
        ]);

        // 다시 읽힌 회차는 실패 전의 값과 비교함 확인
        table["rlprobe-a"] = shown("running", "-", 2);
        expect(round(box, "--container", "rlprobe-a").lines).toEqual([
            "2026-11-12 09:00:00 RECOVER container rlprobe-a Status running · Health -",
            "2026-11-12 09:00:00 ALERT restart rlprobe-a RestartCount 기준 0 · 관측 2"
        ]);
    });
});

describe("watch script claim signal", () => {
    it("skips what the log already held and reports the first 500 line added afterwards", () => {
        // 과거 500 줄이 든 로그
        const box = fake();
        box.put(LOG, `${FAIL}\n`);

        expect(round(box, ...WEB).lines).toEqual([BEGIN]);
        box.add(LOG, `${NEXT}\n`);
        expect(round(box, ...WEB).lines).toEqual([
            "2026-11-12 09:00:00 ALERT claim web 2026-11-12 08:59:31  POST /api/internal/jobs/claim 500 in 9ms"
        ]);
    });

    it("alerts once for a run of 500 lines and names its first line", () => {
        // 읽기 위치를 잡은 빈 로그
        const box = logged();
        box.add(LOG, `${FAIL}\n${NEXT}\n`);

        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        box.add(LOG, `${NEXT}\n`);
        expect(round(box, ...WEB).lines).toEqual([]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it.each([
        ["a 200 claim line", DONE],
        ["an idle summary line", IDLE]
    ])("recovers after a read without 500 that holds %s", (_label, proof) => {
        // 500 줄로 이상에 들어선 로그
        const box = logged();
        box.add(LOG, `${FAIL}\n`);
        round(box, ...WEB);
        box.add(LOG, `${proof}\n`);

        expect(round(box, ...WEB).lines).toEqual([RELIEF]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it("recovers on the next read when proof follows the last 500 inside one read", () => {
        // 500 줄 뒤에 유휴 요약 줄이 온 읽기
        const box = logged();
        box.add(LOG, `${FAIL}\n${IDLE}\n`);

        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        expect(round(box, ...WEB).lines).toEqual([RELIEF]);
    });

    it("keeps the alert when a 500 follows the proof inside one read", () => {
        // 회복 증거 뒤에 다시 500 줄이 온 읽기
        const box = logged();
        box.add(LOG, `${FAIL}\n`);
        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        box.add(LOG, `${IDLE}\n${DONE}\n${NEXT}\n`);

        expect(round(box, ...WEB).lines).toEqual([]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it("does not count a 200 line seen before the run as proof", () => {
        // 연속 구간이 없을 때의 200 줄과 요약 줄
        const box = logged();
        box.add(LOG, `${DONE}\n${IDLE}\n`);

        expect(round(box, ...WEB).lines).toEqual([]);
        box.add(LOG, `${FAIL}\n`);
        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it.each([
        ["a 400 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 400 in 3ms"],
        ["a 401 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 401 in 3ms"],
        ["a 409 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 409 in 3ms"],
        ["a 204 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 204 in 3ms"],
        ["a four digit status", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 2000 in 3ms"],
        ["a 200 line of another route", "2026-11-12 09:01:00  POST /api/internal/jobs/7d1e/progress 200 in 8ms"],
        ["the final summary line", LAST]
    ])("does not take %s as proof", (_label, row) => {
        // 500 줄로 이상에 들어선 로그
        const box = logged();
        box.add(LOG, `${FAIL}\n`);
        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        box.add(LOG, `${row}\n`);

        expect(round(box, ...WEB).lines).toEqual([]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it.each([
        ["a 400 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 400 in 3ms"],
        ["a 409 claim line", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 409 in 3ms"],
        ["a four digit status starting with 500", "2026-11-12 09:01:00  POST /api/internal/jobs/claim 5000 in 3ms"],
        ["a 500 line of another route", "2026-11-12 09:01:00  POST /api/internal/jobs/7d1e/progress 500 in 8ms"]
    ])("does not alert for %s", (_label, row) => {
        // 읽기 위치를 잡은 빈 로그
        const box = logged();
        box.add(LOG, `${row}\n`);

        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it("leaves an unfinished line for the next check", () => {
        // 줄바꿈 없이 끝난 500 줄의 앞부분
        const box = logged();
        box.add(LOG, "2026-11-12 08:59:30  POST /api/internal/jobs/claim 5");

        expect(round(box, ...WEB).lines).toEqual([]);
        box.add(LOG, "00 in 12ms\n");
        expect(round(box, ...WEB).lines).toEqual([ALARM]);
    });

    it("advances by bytes when a line holds multi-byte text", () => {
        // 한글 서른 자가 앞에 붙은 500 줄
        const box = logged();
        box.add(LOG, `${"가".repeat(30)} ${FAIL}\n`);

        expect(round(box, ...WEB).lines).toEqual([
            `2026-11-12 09:00:00 ALERT claim web ${"가".repeat(30)} 2026-11-12 08:59:30  POST /api/internal/jobs/claim 500 in 12ms`
        ]);
        box.add(LOG, `${DONE}\n`);
        expect(round(box, ...WEB).lines).toEqual([RELIEF]);
    });

    it("cuts the first line to 200 characters and drops control characters", () => {
        // 제어 문자가 섞인 긴 500 줄
        const box = logged();
        box.add(LOG, `\u001b${FAIL} ${"x".repeat(100)}\u0007${"x".repeat(200)}\n`);

        expect(round(box, ...WEB).lines).toEqual([`${ALARM} ${"x".repeat(137)}`]);
    });
});

describe("watch script log reading", () => {
    it("starts again from the beginning and notes it when the log is replaced", () => {
        // 읽기 위치를 잡은 뒤 새 식별 번호로 바뀐 로그
        const box = logged(`${DONE}\n`);
        box.put(LOG, `${FAIL}\n`);

        expect(round(box, ...WEB).lines).toEqual(["2026-11-12 09:00:00 NOTE log web 로그 교체 · 처음부터 읽음", ALARM]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it("starts again from the beginning and notes it when the log shrinks", () => {
        // 읽기 위치를 잡은 뒤 같은 식별 번호로 줄어든 로그
        const box = logged(`${DONE}\n${DONE}\n${DONE}\n`);
        swap(box, LOG, `${FAIL}\n`);

        expect(round(box, ...WEB).lines).toEqual(["2026-11-12 09:00:00 NOTE log web 로그 축소 · 처음부터 읽음", ALARM]);
        expect(round(box, ...WEB).lines).toEqual([]);
    });

    it("keeps the run of 500 lines across a replaced log", () => {
        // 이상에 들어선 뒤 200 줄만 든 새 로그로 교체
        const box = logged();
        box.add(LOG, `${FAIL}\n`);
        round(box, ...WEB);
        box.put(LOG, `${DONE}\n`);

        expect(round(box, ...WEB).lines).toEqual(["2026-11-12 09:00:00 NOTE log web 로그 교체 · 처음부터 읽음", RELIEF]);
    });

    it("skips lines written before a fresh start", () => {
        // 감시가 꺼진 사이 늘어난 500 줄
        const box = logged();
        box.add(LOG, `${FAIL}\n`);

        expect(round(box, ...WEB, "--fresh").lines).toEqual([]);
        box.add(LOG, `${NEXT}\n`);
        expect(round(box, ...WEB).lines).toEqual([
            "2026-11-12 09:00:00 ALERT claim web 2026-11-12 08:59:31  POST /api/internal/jobs/claim 500 in 9ms"
        ]);
    });

    it("does not note a replaced log on a fresh start", () => {
        // 감시가 꺼진 사이 교체된 로그
        const box = logged(`${DONE}\n`);
        box.put(LOG, `${FAIL}\n`);

        expect(round(box, ...WEB, "--fresh").lines).toEqual([]);
    });

    it("reads a log that appears later from its beginning and notes it", () => {
        // 로그 없이 지난 첫 점검
        const box = fake();

        expect(round(box, ...DOWN).lines).toEqual([BEGIN]);
        box.put(LOG, `${FAIL}\n`);
        expect(round(box, ...DOWN).lines).toEqual(["2026-11-12 09:00:00 NOTE log web 로그 생김 · 처음부터 읽음", ALARM]);
    });

    it("keeps the claim verdict while the log is missing", () => {
        // 회복 증거까지 읽은 뒤 사라진 로그
        const box = logged();
        box.add(LOG, `${FAIL}\n${DONE}\n`);

        expect(round(box, ...WEB).lines).toEqual([ALARM]);
        box.files.delete(LOG);
        expect(round(box, ...DOWN).lines).toEqual([]);
    });
});

describe("watch script log signal", () => {
    it("alerts once when the web is ready without its log and recovers when the log appears", () => {
        // 로그가 없는 준비된 웹
        const box = fake();

        expect(round(box, ...WEB).lines).toEqual([BEGIN, "2026-11-12 09:00:00 ALERT log web 준비 상태인데 로그 파일 없음"]);
        expect(round(box, ...WEB).lines).toEqual([]);
        box.put(LOG, "");
        expect(round(box, ...WEB).lines).toEqual([
            "2026-11-12 09:00:00 NOTE log web 로그 생김 · 처음부터 읽음",
            "2026-11-12 09:00:00 RECOVER log web 로그 파일 있음"
        ]);
    });

    it("recovers when the web stops being ready", () => {
        // 로그 없는 준비 상태로 이상에 들어선 웹
        const box = fake();
        round(box, ...WEB);

        expect(round(box, ...DOWN).lines).toEqual(["2026-11-12 09:00:00 RECOVER log web 서비스 준비 아님"]);
    });

    it.each(["web=0:0:0:-", "web=1:0:0:5", "web=1:1:0:5"])("stays normal for a missing log while the web is seen as %s", (seen) => {
        // 준비 상태가 아닌 웹
        const box = fake();

        expect(round(box, "--log", `web=${LOG}`, "--service", seen, "--grace", "95").lines).toEqual([BEGIN]);
    });
});

describe("watch script db signal", () => {
    it("runs one read-only query with a fixed argument list and a ten second limit", () => {
        // UTC 자정의 가짜 시계와 빈 표의 응답
        const box = fake();
        box.clock = new Date("2026-11-12T00:00:00.000Z");
        psql(box, "0|0|-\n");
        round(box, ...DB);

        // 암호 인자 없이 셸을 거치지 않는 인자 배열과 시간 제한 확인
        expect(box.calls).toEqual([
            {
                file: "docker",
                args: ["exec", "-e", GUARD, "rlprobe-db", "psql", "-X", "-U", "replay", "-d", "replay_lab", "-At", "-c", LEASE],
                limit: 10_000
            }
        ]);
    });

    it.each<[string, string | Result, string]>([
        ["a stopped container", { code: 1, out: "", err: "Error response from daemon: container 1a2b is not running\n" }, "종료 코드 1 · Error response from daemon: container 1a2b is not running"],
        ["a command that cannot run or times out", { code: null, out: "", err: "" }, "실행 불가 또는 시간 초과"],
        ["a failure without an error text", { code: 2, out: "", err: "" }, "종료 코드 2"],
        ["a statement timeout", { code: 1, out: "", err: "ERROR:  canceling statement due to statement timeout\n" }, "종료 코드 1 · ERROR:  canceling statement due to statement timeout"],
        ["an empty output", "", "형식 불일치"],
        ["two fields", "0|0\n", "형식 불일치"],
        ["four fields", "0|0|-|0\n", "형식 불일치"],
        ["two rows", "0|0|-\n0|0|-\n", "형식 불일치"],
        ["a count that is not a number", "many|0|-\n", "형식 불일치"],
        ["a negative count", "-1|0|-\n", "형식 불일치"],
        ["a heartbeat that is not a UTC second", "2|1|2026-11-10 07:29:00+00\n", "형식 불일치"]
    ])("alerts for %s", (_name, answer, text) => {
        // 조회가 실패하는 가짜 실행 환경
        const box = fake();
        psql(box, answer);

        expect(round(box, ...DB).lines).toEqual([BEGIN, `2026-11-12 09:00:00 ALERT db rlprobe-db 조회 실패 · ${text}`]);
    });

    it("alerts once while the query keeps failing and recovers once", () => {
        // 조회가 실패하는 가짜 실행 환경
        const box = fake();
        psql(box, { code: null, out: "", err: "" });

        // 이상에 들어선 회차의 경보와 지속 중 무음 확인
        expect(round(box, ...DB).lines).toEqual([
            BEGIN,
            "2026-11-12 09:00:00 ALERT db rlprobe-db 조회 실패 · 실행 불가 또는 시간 초과"
        ]);
        expect(round(box, ...DB).lines).toEqual([]);

        // 조회가 성공한 회차의 회복 줄과 그 뒤 무음 확인
        psql(box, "0|0|-\n");
        expect(round(box, ...DB).lines).toEqual(["2026-11-12 09:00:00 RECOVER db rlprobe-db 조회 성공"]);
        expect(round(box, ...DB).lines).toEqual([]);
    });

    it("does not query without the DB arguments", () => {
        // DB 인자 없이 컨테이너 하나만 점검하는 가짜 실행 환경
        const box = fake();
        docker(box, { "rlprobe-a": shown("running", "healthy", 0) });
        round(box, "--container", "rlprobe-a");

        expect(box.calls.map((call) => call.args[0])).toEqual(["inspect"]);
    });
});

describe("watch script lease signal", () => {
    it("alerts once with the expired count and the oldest heartbeat and recovers once", () => {
        // 만료 행 셋이 있는 가짜 실행 환경
        const box = fake();
        psql(box, "4|3|2026-11-10T07:29:00Z\n");

        // 이상에 들어선 회차의 경보와 만료 수가 바뀐 지속 중 무음 확인
        expect(round(box, ...DB).lines).toEqual([
            BEGIN,
            "2026-11-12 09:00:00 ALERT lease rlprobe-db 만료 3건 · 가장 오래된 heartbeat 2026-11-10T07:29:00Z"
        ]);
        psql(box, "6|5|2026-11-10T07:29:00Z\n");
        expect(round(box, ...DB).lines).toEqual([]);

        // 만료 행이 사라진 회차의 회복 줄과 그 뒤 무음 확인
        psql(box, "1|0|-\n");
        expect(round(box, ...DB).lines).toEqual(["2026-11-12 09:00:00 RECOVER lease rlprobe-db 만료 0건"]);
        expect(round(box, ...DB).lines).toEqual([]);
    });

    it("reports a missing heartbeat on the expired rows", () => {
        // heartbeat가 비어 있는 만료 행 둘
        const box = fake();
        psql(box, "2|2|-\n");

        expect(round(box, ...DB).lines).toEqual([
            BEGIN,
            "2026-11-12 09:00:00 ALERT lease rlprobe-db 만료 2건 · 가장 오래된 heartbeat 없음"
        ]);
    });

    it("stays normal while rows are processing without an expired lease", () => {
        // 진행 중 행 넷과 만료 행 없음
        const box = fake();
        psql(box, "4|0|-\n");

        // 회차마다 조회 한 번과 무음 확인
        expect(round(box, ...DB).lines).toEqual([BEGIN]);
        expect(round(box, ...DB).lines).toEqual([]);
        expect(box.calls).toHaveLength(2);
    });

    it.each<[string, string | Result, string]>([
        ["cannot run", { code: null, out: "", err: "" }, "실행 불가 또는 시간 초과"],
        ["returns a malformed result", "garbage\n", "형식 불일치"]
    ])("keeps the lease alert while the query %s", (_name, answer, text) => {
        // 만료 행을 알린 가짜 실행 환경
        const box = fake();
        psql(box, "4|3|2026-11-10T07:29:00Z\n");
        round(box, ...DB);

        // 조회가 실패한 회차에 lease 회복 줄 없음 확인
        psql(box, answer);
        expect(round(box, ...DB).lines).toEqual([`2026-11-12 09:00:00 ALERT db rlprobe-db 조회 실패 · ${text}`]);

        // 조회가 다시 성공한 회차의 db 회복 줄과 lease 회복 줄 순서 확인
        psql(box, "0|0|-\n");
        expect(round(box, ...DB).lines).toEqual([
            "2026-11-12 09:00:00 RECOVER db rlprobe-db 조회 성공",
            "2026-11-12 09:00:00 RECOVER lease rlprobe-db 만료 0건"
        ]);
    });

    it("keeps the lease normal while the query fails and alerts when it works again", () => {
        // 만료 행 없이 한 번 점검한 가짜 실행 환경
        const box = fake();
        psql(box, "1|0|-\n");
        round(box, ...DB);

        // 조회가 실패한 회차에 lease 경보 없음 확인
        psql(box, { code: null, out: "", err: "" });
        expect(round(box, ...DB).lines).toEqual(["2026-11-12 09:00:00 ALERT db rlprobe-db 조회 실패 · 실행 불가 또는 시간 초과"]);

        // 조회가 다시 성공한 회차의 db 회복 줄과 lease 경보 확인
        psql(box, "2|1|2026-11-12T08:40:00Z\n");
        expect(round(box, ...DB).lines).toEqual([
            "2026-11-12 09:00:00 RECOVER db rlprobe-db 조회 성공",
            "2026-11-12 09:00:00 ALERT lease rlprobe-db 만료 1건 · 가장 오래된 heartbeat 2026-11-12T08:40:00Z"
        ]);
    });
});

describe("watch script service signal", () => {
    it("alerts when the group is missing in two checks in a row and stays silent afterwards", () => {
        // pid 기록은 있고 그룹이 없는 검증 Worker
        const box = fake();

        // 첫 번째 이상 관측의 직전 판정 유지와 두 번째의 경보 확인
        expect(glance(box, "validate=1:0:0:40")).toEqual([BEGIN]);
        expect(glance(box, "validate=1:0:0:100")).toEqual([GONE]);
        expect(glance(box, "validate=1:0:0:160")).toEqual([]);
    });

    it.each<[string, string, string]>([
        ["is ready again", "validate=1:1:1:3", "기록 있음 · 그룹 있음 · 준비됨"],
        ["has no pid record", "validate=0:0:0:-", "기록 없음"]
    ])("recovers when the service %s", (_name, value, text) => {
        // 그룹이 없어 경보를 낸 가짜 실행 환경
        const box = fake();
        glance(box, "validate=1:0:0:40");
        glance(box, "validate=1:0:0:100");

        expect(glance(box, value)).toEqual([`2026-11-12 09:00:00 RECOVER service validate ${text}`]);
        expect(glance(box, value)).toEqual([]);
    });

    it("keeps the alert while the service is starting within the grace and recovers once it is ready", () => {
        // 그룹이 없어 경보를 낸 가짜 실행 환경
        const box = fake();
        glance(box, "validate=1:0:0:40");
        expect(glance(box, "validate=1:0:0:100")).toEqual([GONE]);

        // 기동 중의 직전 판정 유지와 준비 뒤 회복 확인
        expect(glance(box, "validate=1:1:0:10")).toEqual([]);
        expect(glance(box, "validate=1:1:1:70")).toEqual([
            "2026-11-12 09:00:00 RECOVER service validate 기록 있음 · 그룹 있음 · 준비됨"
        ]);
    });

    it.each(["validate=1:1:1:2", "validate=0:0:0:-", "validate=1:1:0:10"])("starts the count again after %s comes between", (value) => {
        // 이상 관측 사이에 다른 관측이 낀 가짜 실행 환경
        const box = fake();

        expect(glance(box, "validate=1:0:0:40")).toEqual([BEGIN]);
        expect(glance(box, value)).toEqual([]);
        expect(glance(box, "validate=1:0:0:40")).toEqual([]);
        expect(glance(box, "validate=1:0:0:100")).toEqual([GONE]);
    });

    it("treats a service that is not ready as starting until its age passes the grace", () => {
        // 준비되지 않은 웹
        const box = fake();

        // 한도와 같은 경과 초의 직전 판정 유지 확인
        expect(glance(box, "web=1:1:0:95")).toEqual([BEGIN]);
        expect(glance(box, "web=1:1:0:95")).toEqual([]);

        // 한도를 넘은 관측이 두 번 이어진 회차의 경보 확인
        expect(glance(box, "web=1:1:0:96")).toEqual([]);
        expect(glance(box, "web=1:1:0:156")).toEqual([
            "2026-11-12 09:00:00 ALERT service web 기록 있음 · 그룹 있음 · 준비 아님 · 경과 156초 · 한도 95초"
        ]);
    });

    it("judges each service on its own", () => {
        // 그룹이 없는 웹과 한 회차 늦게 그룹을 잃는 분석 Worker
        const box = fake();

        expect(glance(box, "web=1:0:0:40", "analyze=1:1:1:40")).toEqual([BEGIN]);
        expect(glance(box, "web=1:0:0:100", "analyze=1:0:0:100")).toEqual([
            "2026-11-12 09:00:00 ALERT service web 기록 있음 · 그룹 없음"
        ]);
        expect(glance(box, "web=1:0:0:160", "analyze=1:0:0:160")).toEqual([
            "2026-11-12 09:00:00 ALERT service analyze 기록 있음 · 그룹 없음"
        ]);
    });

    it("reports services in the order of the arguments", () => {
        // 함께 그룹을 잃은 분석 Worker와 웹
        const box = fake();
        glance(box, "analyze=1:0:0:40", "web=1:0:0:40");

        expect(glance(box, "analyze=1:0:0:100", "web=1:0:0:100")).toEqual([
            "2026-11-12 09:00:00 ALERT service analyze 기록 있음 · 그룹 없음",
            "2026-11-12 09:00:00 ALERT service web 기록 있음 · 그룹 없음"
        ]);
    });

    it("does not alert for a stopped web while a Worker keeps running", () => {
        // pid 기록이 없는 웹과 준비된 검증 Worker
        const box = fake();

        expect(glance(box, "web=0:0:0:-", "validate=1:1:1:500")).toEqual([BEGIN]);
        expect(glance(box, "web=0:0:0:-", "validate=1:1:1:560")).toEqual([]);
    });

    it("counts a service named constructor like any other", () => {
        // 객체의 내장 이름과 같은 서비스 이름
        const box = fake();
        glance(box, "constructor=1:0:0:40");

        expect(glance(box, "constructor=1:0:0:100")).toEqual([
            "2026-11-12 09:00:00 ALERT service constructor 기록 있음 · 그룹 없음"
        ]);
    });
});
