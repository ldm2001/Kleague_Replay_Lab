import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 사용법 문구
const USAGE = [
    "사용법: node watch.mjs --state <파일> --marker <파일> [--container <이름>]... [--baseline <파일>]",
    "    [--log <서비스>=<경로>] [--service <이름>=<기록>:<그룹>:<준비>:<경과 초>]... [--grace <초>]",
    "    [--db-container <이름> --db-user <사용자> --db-name <DB>] [--fresh] [--silent]",
    "       node watch.mjs --report --state <파일> --marker <파일>"
].join("\n");

// 상태 파일 형식 판 번호
const VERSION = 1;

// 값 하나를 한 번만 받는 인자
const SINGLE = new Set([
    "--state",
    "--marker",
    "--baseline",
    "--log",
    "--grace",
    "--db-container",
    "--db-user",
    "--db-name"
]);

// 값마다 반복하는 인자
const MANY = new Set(["--container", "--service"]);

// 값이 없는 인자
const SWITCH = new Set(["--fresh", "--silent", "--report"]);

// 컨테이너 이름 형식
const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// DB 사용자와 DB 이름 형식
const ROLE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

// 서비스 이름 형식
const SERVICE = /^[a-z][a-z0-9_-]*$/;

// 서비스 관측값 형식
const SEEN = /^(?:0:0:0:-|1:0:0:\d{1,15}|1:1:0:\d{1,15}|1:1:1:\d{1,15})$/;

// 외부 명령 시간 제한 밀리초
const LIMIT = 10_000;

// inspect 출력 형식
const FORMAT = "{{.Id}}|{{.Created}}|{{.State.Status}}|{{with index .State \"Health\"}}{{.Status}}{{else}}-{{end}}|{{.RestartCount}}";

// 건강 검사 칸에 올 수 있는 값
const HEALTH = new Set(["-", "starting", "healthy", "unhealthy"]);

// UTC 시각 문자열 형식
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// 선점 줄의 상태 코드 형식
const CLAIM = /POST \/api\/internal\/jobs\/claim (\d{3})(?!\d)/;

// 유휴 요약 줄의 표지
const IDLE = "[services] idle claim 204 x";

// 읽기 전용과 문장 시간 제한을 강제하는 연결 설정
const GUARD = "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000";

// 임대 조회 결과의 세 칸 형식
const ROW = /^(\d{1,15})\|(\d{1,15})\|(-|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

// 사용법 오류
class Fault extends Error {}

// 실제 표준 출력과 표준 오류를 쓰는 실행 환경
const real = {
    // 표준 출력 한 줄 기록
    print(line) {
        process.stdout.write(`${line}\n`);
    },
    // 표준 오류 한 줄 기록
    warn(line) {
        process.stderr.write(`${line}\n`);
    }
};

// 현지 시각 문자열 생성
function stamp(date) {
    // 두 자리 숫자 채움
    const pad = (value) => String(value).padStart(2, "0");
    // 날짜 부분
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    // 시각 부분
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    return `${day} ${time}`;
}

// 이름과 값으로 나뉜 인자 값 읽음
function pair(flag, value) {
    // 이름과 값을 가르는 첫 등호 위치
    const cut = value.indexOf("=");
    if (cut < 1 || cut === value.length - 1) throw new Fault(`${flag} 값 형식 오류`);
    return [value.slice(0, cut), value.slice(cut + 1)];
}

// 서비스 관측값 읽음
function sight(values) {
    // 서비스별 관측값
    const seen = new Map();

    for (const value of values) {
        // 서비스 이름과 관측값 문자열
        const [name, text] = pair("--service", value);
        if (!SERVICE.test(name)) throw new Fault("--service 이름 형식 오류");
        if (seen.has(name)) throw new Fault("--service 이름 반복");
        if (!SEEN.test(text)) throw new Fault("--service 값 조합 오류");
        // 기록과 그룹과 준비와 경과 초
        const [record, group, up, age] = text.split(":");
        seen.set(name, {
            record: record === "1",
            group: group === "1",
            up: up === "1",
            age: age === "-" ? null : Number(age)
        });
    }
    return seen;
}

// DB 인자 셋 읽음
function store(single) {
    // DB 컨테이너와 사용자와 이름
    const [container, user, name] = ["--db-container", "--db-user", "--db-name"].map((flag) => single.get(flag));
    // 준 DB 인자 수
    const given = [container, user, name].filter((value) => value !== undefined).length;
    if (given === 0) return null;
    if (given !== 3) throw new Fault("DB 인자는 셋을 함께 지정");
    if (!CONTAINER.test(container)) throw new Fault("--db-container 이름 형식 오류");
    if (!ROLE.test(user)) throw new Fault("--db-user 이름 형식 오류");
    if (!ROLE.test(name)) throw new Fault("--db-name 이름 형식 오류");
    return { container, user, name };
}

// 인자 해석과 검증
function options(argv) {
    // 한 번만 받는 인자의 값
    const single = new Map();
    // 컨테이너 이름 목록
    const containers = [];
    // 서비스 관측값 문자열 목록
    const services = [];
    // 받은 값 없는 인자
    const flags = new Set();

    for (let index = 0; index < argv.length; index += 1) {
        // 이번 인자 이름
        const flag = argv[index];
        if (SWITCH.has(flag)) {
            if (flags.has(flag)) throw new Fault(`${flag} 반복`);
            flags.add(flag);
            continue;
        }
        if (!SINGLE.has(flag) && !MANY.has(flag)) throw new Fault("알 수 없는 인자");
        // 이번 인자의 값
        const value = argv[index + 1];
        if (value === undefined || value === "" || value.startsWith("--")) throw new Fault(`${flag} 값 없음`);
        index += 1;
        if (flag === "--container") {
            containers.push(value);
            continue;
        }
        if (flag === "--service") {
            services.push(value);
            continue;
        }
        if (single.has(flag)) throw new Fault(`${flag} 반복`);
        single.set(flag, value);
    }

    // 항상 필요한 두 경로
    const state = single.get("--state");
    const marker = single.get("--marker");
    if (state === undefined) throw new Fault("--state 필요");
    if (marker === undefined) throw new Fault("--marker 필요");

    if (flags.has("--report")) {
        // 보고에서 받지 않는 인자 확인
        const extra = single.size > 2 || containers.length > 0 || services.length > 0 || flags.size > 1;
        if (extra) throw new Fault("--report와 함께 쓸 수 없는 인자");
        return { report: true, state, marker };
    }

    for (const name of containers) {
        if (!CONTAINER.test(name)) throw new Fault("--container 이름 형식 오류");
    }
    if (new Set(containers).size !== containers.length) throw new Fault("--container 이름 반복");

    // 서비스별 관측값
    const seen = sight(services);
    // 기동 대기 한도
    const grace = single.get("--grace");
    if (grace !== undefined && !/^\d{1,15}$/.test(grace)) throw new Fault("--grace 값 형식 오류");
    if (seen.size > 0 && grace === undefined) throw new Fault("--service에는 --grace 필요");

    // 로그 대상
    let log = null;
    if (single.has("--log")) {
        // 로그의 서비스 이름과 경로
        const [name, path] = pair("--log", single.get("--log"));
        if (!seen.has(name)) throw new Fault("--log의 서비스가 --service에 없음");
        log = { name, path };
    }

    return {
        report: false,
        state,
        marker,
        baseline: single.get("--baseline") ?? null,
        containers,
        log,
        services: seen,
        grace: grace === undefined ? null : Number(grace),
        db: store(single),
        fresh: flags.has("--fresh"),
        silent: flags.has("--silent")
    };
}

// 사전 꼴 객체 확인
function table(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 사전의 모든 값 확인
function every(map, test) {
    return table(map) && Object.values(map).every(test);
}

// 음이 아닌 정수 확인
function whole(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

// 신호 기록 형식 확인
function signal(item) {
    return table(item)
        && typeof item.bad === "boolean"
        && typeof item.told === "boolean"
        && typeof item.text === "string"
        && typeof item.at === "string";
}

// 기록 전용 값 형식 확인
function gauge(item) {
    return table(item)
        && (item.value === null || whole(item.value))
        && (item.at === null || typeof item.at === "string");
}

// 상태 파일 내용의 형식 확인
function sound(data) {
    return typeof data.checkedAt === "string"
        && typeof data.quiet === "boolean"
        && every(data.signals, signal)
        && every(data.containers, (item) => table(item) && typeof item.id === "string" && whole(item.restarts))
        && every(data.logs, (item) => table(item) && (item.inode === null || whole(item.inode)) && whole(item.offset))
        && every(data.claims, (item) => table(item) && typeof item.first === "string" && typeof item.proof === "boolean")
        && every(data.services, whole)
        && table(data.record)
        && gauge(data.record.jobs)
        && gauge(data.record.size);
}

// 새 감시 상태 생성
function blank() {
    return {
        version: VERSION,
        checkedAt: null,
        quiet: false,
        signals: {},
        containers: {},
        logs: {},
        claims: {},
        services: {},
        record: { jobs: { value: null, at: null }, size: { value: null, at: null } }
    };
}

// JSON 해석이며 깨진 내용은 빈 값 반환
function parse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// 상태 파일 읽음
function memory(host, path) {
    // 상태 파일 내용
    const text = host.read(path);
    if (text === null) {
        // 없는 파일과 읽을 수 없는 파일 구분
        const note = host.stat(path) === null ? "상태 파일 없음" : "상태 파일 읽을 수 없음";
        return { state: blank(), note };
    }
    // 해석한 내용
    const data = parse(text);
    if (table(data) && typeof data.version === "number" && data.version !== VERSION) {
        return { state: blank(), note: "상태 파일 판 번호 다름" };
    }
    if (!table(data) || data.version !== VERSION || !sound(data)) {
        return { state: blank(), note: "상태 파일 읽을 수 없음" };
    }
    return { state: data, note: null };
}

// 경보 줄 추가
function line(ctx, kind, name, target, text) {
    ctx.lines.push(`${stamp(ctx.now)} ${kind} ${name} ${target} ${text}`);
}

// 제어 문자를 지우고 길이를 제한한 문구 생성
function plain(text, cap) {
    return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, cap).join("");
}

// 실패한 명령의 사유 문구 생성
function flaw(result) {
    if (result.code === null) return "실행 불가 또는 시간 초과";
    // 표준 오류의 첫 줄
    const first = plain(result.err.split("\n")[0], 160);
    return first === "" ? `종료 코드 ${result.code}` : `종료 코드 ${result.code} · ${first}`;
}

// 사전에서 자기 값만 읽음
function pick(map, key) {
    return Object.hasOwn(map, key) ? map[key] : undefined;
}

// 신호 판정 기록과 경보 줄 결정
function verdict(ctx, name, target, bad, text) {
    // 신호와 대상의 기록 열쇠
    const key = `${name} ${target}`;
    // 직전 기록이며 없으면 정상으로 시작
    const item = pick(ctx.state.signals, key) ?? { bad: false, told: false, text: "", at: ctx.at };
    ctx.state.signals[key] = item;
    item.at = ctx.at;
    // 직전 판정 유지가 아니면 판정과 내용 갱신
    if (bad !== null) {
        item.bad = bad;
        item.text = text;
    }
    if (item.bad && !item.told) {
        line(ctx, "ALERT", name, target, item.text);
        item.told = true;
    } else if (!item.bad && item.told) {
        line(ctx, "RECOVER", name, target, item.text);
        item.told = false;
    }
}

// 컨테이너 한 개의 inspect 결과 읽음
function inspection(host, name) {
    // inspect 호출 결과
    const result = host.run("docker", ["inspect", "--type", "container", "-f", FORMAT, name], LIMIT);
    if (result.code !== 0) return { fail: flaw(result) };
    // 줄바꿈 하나를 뗀 출력의 칸
    const cells = result.out.replace(/\r?\n$/, "").split("|");
    // Id와 생성 시각과 상태와 건강 검사와 재시작 횟수
    const [id, created, status, health, restarts] = cells;
    // 다섯 칸 형식의 엄격한 확인
    const exact = cells.length === 5
        && /^[0-9a-f]{64}$/.test(id)
        && INSTANT.test(created)
        && !Number.isNaN(Date.parse(created))
        && /^[a-z]+$/.test(status)
        && HEALTH.has(health)
        && /^\d{1,9}$/.test(restarts);
    if (!exact) return { fail: "형식 불일치" };
    return { id, created: Date.parse(created), status, health, restarts: Number(restarts) };
}

// 기준값 파일 내용에서 기록 시각과 컨테이너의 재시작 횟수 읽음
function origin(text, name) {
    if (text === null) return null;
    // 줄 목록
    const rows = text.split("\n");
    // 첫 줄의 기록 시각
    const head = /^recordedAt\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/.exec(rows[0]);
    if (head === null || Number.isNaN(Date.parse(head[1]))) return null;
    // 그 컨테이너의 줄
    const cells = rows.slice(1).map((row) => row.split("|")).find((row) => row[0] === `/${name}`);
    if (cells === undefined || cells.length < 5 || !/^\d{1,9}$/.test(cells[4])) return null;
    return { at: Date.parse(head[1]), restarts: Number(cells[4]) };
}

// 저장된 값이 없는 컨테이너의 비교 기준 선택
function baseline(ctx, name, seen) {
    // 기준값 파일의 기록
    const found = ctx.opts.baseline === null ? null : origin(ctx.host.read(ctx.opts.baseline), name);
    if (found === null) {
        line(ctx, "NOTE", "restart", name, `기준 ${seen.restarts} · 첫 관측값`);
        return seen.restarts;
    }
    // 초 단위로 내린 생성 시각이 기록 시각보다 늦으면 기록 뒤 재생성
    if (Math.floor(seen.created / 1000) * 1000 > found.at) {
        line(ctx, "NOTE", "restart", name, "기준 0 · 기준값 기록 뒤 재생성");
        return 0;
    }
    return found.restarts;
}

// 재시작 횟수 비교와 사건 줄 결정
function restart(ctx, name, seen) {
    // 직전에 본 Id와 재시작 횟수
    const last = pick(ctx.state.containers, name);
    // 비교 기준
    let base = 0;
    if (last === undefined) {
        base = baseline(ctx, name, seen);
    } else if (last.id === seen.id) {
        base = last.restarts;
    } else {
        line(ctx, "NOTE", "restart", name, "기준 0 · 컨테이너 교체");
    }
    if (seen.restarts < base) {
        line(ctx, "NOTE", "restart", name, `기준 ${base} · 관측 ${seen.restarts} · 감소 뒤 0과 비교`);
        base = 0;
    }
    if (seen.restarts > base) {
        line(ctx, "ALERT", "restart", name, `RestartCount 기준 ${base} · 관측 ${seen.restarts}`);
    }
    ctx.state.containers[name] = { id: seen.id, restarts: seen.restarts };
}

// 컨테이너 신호와 재시작 사건 점검
function containers(ctx) {
    for (const name of ctx.opts.containers) {
        // 이번 관측
        const seen = inspection(ctx.host, name);
        if (seen.fail !== undefined) {
            verdict(ctx, "container", name, true, `inspect 실패 · ${seen.fail}`);
            continue;
        }
        // 실행 중이며 건강 검사가 기동 중이면 직전 판정 유지
        let bad = false;
        if (seen.status !== "running" || seen.health === "unhealthy") {
            bad = true;
        } else if (seen.health === "starting") {
            bad = null;
        }
        verdict(ctx, "container", name, bad, `Status ${seen.status} · Health ${seen.health}`);
        restart(ctx, name, seen);
    }
}

// 읽기 위치를 처음으로 되돌리는 사유 확인
function rewind(last, mark) {
    if (last.inode === null) return "로그 생김";
    if (last.inode !== mark.inode) return "로그 교체";
    if (mark.size < last.offset) return "로그 축소";
    return null;
}

// 로그에서 새로 늘어난 줄 읽음
function tail(ctx, log, mark) {
    // 직전 읽기 위치
    const last = pick(ctx.state.logs, log.name);
    // 이번 읽기의 시작 위치이며 저장된 위치가 없거나 새로 시작하면 파일 끝
    let start = mark.size;
    if (!ctx.opts.fresh && last !== undefined) {
        // 처음부터 다시 읽는 사유
        const cause = rewind(last, mark);
        if (cause !== null) line(ctx, "NOTE", "log", log.name, `${cause} · 처음부터 읽음`);
        start = cause === null ? last.offset : 0;
    }
    // 새로 늘어난 부분
    const data = start < mark.size ? ctx.host.part(log.path, start, mark.size) : new Uint8Array(0);
    // 마지막 줄바꿈 위치이며 끝나지 않은 줄은 다음 점검으로 미룸
    const end = data.lastIndexOf(10);
    ctx.state.logs[log.name] = { inode: mark.inode, offset: start + end + 1 };
    return end < 0 ? [] : new TextDecoder().decode(data.subarray(0, end)).split("\n");
}

// 새 줄로 claim 연속 구간과 판정 갱신
function claim(ctx, name, rows) {
    // 연속 구간의 첫 줄과 회복 증거 여부
    const run = pick(ctx.state.claims, name) ?? { first: "", proof: false };
    ctx.state.claims[name] = run;
    // 이번 읽기의 500 여부
    let hit = false;

    for (const row of rows) {
        // 선점 줄의 상태 코드
        const code = CLAIM.exec(row)?.[1];
        if (code === "500") {
            hit = true;
            if (run.first === "") run.first = plain(row, 200);
            run.proof = false;
        } else if (run.first !== "" && (code === "200" || row.includes(IDLE))) {
            run.proof = true;
        }
    }

    if (hit) {
        verdict(ctx, "claim", name, true, run.first);
    } else if (run.proof) {
        ctx.state.claims[name] = { first: "", proof: false };
        verdict(ctx, "claim", name, false, "500 없는 읽기 · 회복 증거 확인");
    } else {
        verdict(ctx, "claim", name, null, "");
    }
}

// 로그 신호와 claim 신호 점검
function logs(ctx) {
    // 로그 대상
    const log = ctx.opts.log;
    if (log === null) return;
    // 로그 파일의 식별 번호와 크기
    const mark = ctx.host.stat(log.path);
    // 그 서비스의 준비 여부
    const up = ctx.opts.services.get(log.name).up;
    if (mark === null) {
        // 없는 파일은 읽지 않고 claim 판정을 그대로 둠
        ctx.state.logs[log.name] = { inode: null, offset: 0 };
        verdict(ctx, "log", log.name, up, up ? "준비 상태인데 로그 파일 없음" : "서비스 준비 아님");
        return;
    }
    // 새로 늘어난 줄
    const rows = tail(ctx, log, mark);
    verdict(ctx, "log", log.name, false, "로그 파일 있음");
    claim(ctx, log.name, rows);
}

// 임대 조회 한 건의 결과 읽음
function leases(ctx, db) {
    // 암호 인자와 셸이 없는 psql 인자 배열
    const args = ["exec", "-e", GUARD, db.container, "psql", "-X", "-U", db.user, "-d", db.name, "-At", "-c", query(ctx.at)];
    // 조회 호출 결과
    const result = ctx.host.run("docker", args, LIMIT);
    if (result.code !== 0) return { fail: flaw(result) };
    // 줄바꿈 하나를 뗀 출력의 세 칸
    const cells = ROW.exec(result.out.replace(/\r?\n$/, ""));
    if (cells === null) return { fail: "형식 불일치" };
    return { late: Number(cells[2]), oldest: cells[3] };
}

// db 신호와 lease 신호 점검
function database(ctx) {
    // DB 대상
    const db = ctx.opts.db;
    if (db === null) return;
    // 이번 조회 결과
    const seen = leases(ctx, db);
    if (seen.fail !== undefined) {
        // 조회가 실패한 동안 lease 판정은 그대로 둠
        verdict(ctx, "db", db.container, true, `조회 실패 · ${seen.fail}`);
        verdict(ctx, "lease", db.container, null, "");
        return;
    }
    verdict(ctx, "db", db.container, false, "조회 성공");
    // 만료 행 가운데 가장 오래된 heartbeat 표기
    const oldest = seen.oldest === "-" ? "없음" : seen.oldest;
    // 만료 행이 있으면 이상
    const bad = seen.late > 0;
    verdict(ctx, "lease", db.container, bad, bad ? `만료 ${seen.late}건 · 가장 오래된 heartbeat ${oldest}` : "만료 0건");
}

// 서비스 관측 한 건의 종류와 내용 문구 생성
function grade(seen, grace) {
    if (!seen.record) return { kind: "good", text: "기록 없음" };
    if (!seen.group) return { kind: "odd", text: "기록 있음 · 그룹 없음" };
    if (seen.up) return { kind: "good", text: "기록 있음 · 그룹 있음 · 준비됨" };
    // 기동 대기 한도를 넘은 준비 아님은 이상 관측이고 한도 안은 기동 중
    const kind = seen.age > grace ? "odd" : "keep";
    return { kind, text: `기록 있음 · 그룹 있음 · 준비 아님 · 경과 ${seen.age}초 · 한도 ${grace}초` };
}

// 서비스 신호 점검
function services(ctx) {
    for (const [name, seen] of ctx.opts.services) {
        // 이번 관측의 종류와 내용
        const { kind, text } = grade(seen, ctx.opts.grace);
        // 연속 이상 관측 수이며 다른 관측이 오면 0
        const count = kind === "odd" ? Math.min((pick(ctx.state.services, name) ?? 0) + 1, 2) : 0;
        ctx.state.services[name] = count;
        // 기동 중과 첫 번째 이상 관측은 직전 판정 유지
        let bad = null;
        if (kind === "good") {
            bad = false;
        } else if (count === 2) {
            bad = true;
        }
        verdict(ctx, "service", name, bad, text);
    }
}

// 마지막 점검 기록 출력
function report(host, opts) {
    // 읽은 상태와 새로 시작 사유
    const { note } = memory(host, opts.state);
    if (note !== null) host.print("점검 기록 없음");
    host.print(host.stat(opts.marker) === null ? "표시 파일 없음" : "표시 파일 있음");
    return 0;
}

// 한 회차 점검과 기록
function round(host, opts) {
    // 이번 회차의 호스트 시각
    const now = host.now();
    // 읽은 상태와 새로 시작 사유
    const { state, note } = memory(host, opts.state);
    // 회차 동안 모으는 값
    const ctx = { host, opts, state, now, at: now.toISOString(), lines: [] };
    if (note !== null) line(ctx, "NOTE", "state", "-", `${note} · 새로 시작`);
    containers(ctx);
    logs(ctx);
    database(ctx);
    services(ctx);

    state.checkedAt = ctx.at;
    // 모은 줄 출력 뒤 상태 저장
    for (const text of ctx.lines) host.print(text);
    host.save(opts.state, `${JSON.stringify(state, null, 4)}\n`);
    return 0;
}

// 임대 조회문 생성
export function query(now) {
    // 조회문에 넣을 수 있는 UTC 시각 형식만 허용
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(now)) throw new Error("time-invalid");
    // 호스트 시각 기준의 만료 조건
    const late = `lease_until <= '${now}'::timestamptz`;
    return `select count(*), count(*) filter (where ${late}), coalesce(to_char((min(heartbeat_at) filter (where ${late})) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-') from processing_jobs where status = 'PROCESSING'`;
}

// 직접 실행 여부 확인
export function entry(url, path) {
    // 실행 경로가 없으면 가져오기로 판단
    if (path === undefined) return false;
    try {
        // 링크를 푼 실제 경로와 모듈 주소 비교
        return url === pathToFileURL(realpathSync(path)).href;
    } catch {
        // 경로를 찾을 수 없으면 가져오기로 판단
        return false;
    }
}

// 한 회차 점검 실행과 종료 코드 반환
export function watch(argv, host = real) {
    // 해석한 인자
    let opts = null;
    try {
        opts = options(argv);
    } catch (error) {
        if (!(error instanceof Fault)) throw error;
        // 사유와 사용법 안내
        host.warn(`인자 오류: ${error.message}`);
        host.warn(USAGE);
        return 2;
    }
    try {
        return opts.report ? report(host, opts) : round(host, opts);
    } catch (error) {
        // 점검 중 예외는 내부 오류 종료 코드로 보고
        host.warn(`내부 오류: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

// 직접 실행일 때만 인자 해석과 점검 수행
if (entry(import.meta.url, process.argv[1])) {
    process.exitCode = watch(process.argv.slice(2));
}
