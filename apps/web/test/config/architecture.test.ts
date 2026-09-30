// 웹 계층 의존 방향과 공개 진입점 및 실행 순환 적합성 테스트
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// 저장소 루트
const REPO = resolve(".");

// 웹 원본 루트
const ROOT = resolve("apps/web/src");

// 원본 경로 접두어로 구분한 계층 목록
const LAYERS = [
    "shared",
    "rules/data",
    "rules/engine",
    "application",
    "database",
    "adapters",
    "apis",
    "bootstrap",
    "app",
    "views",
    "components",
    "constant",
    "assets",
    "styles"
] as const;

// 계층 이름
type Layer = (typeof LAYERS)[number];

// 계층별 허용 의존 규칙
type Policy = Readonly<{
    // 실행 시점에도 가져올 수 있는 다른 계층
    runtime: readonly Layer[];
    // 형식 위치에서만 가져올 수 있는 다른 계층
    types: readonly Layer[];
    // 가져올 수 있는 외부 패키지와 node 접두어로 묶은 내장 모듈
    packages: readonly string[];
}>;

// 파일 하나의 가져오기
type Edge = Readonly<{
    // 가져오는 파일 절대 경로
    from: string;
    // 가져오기 지정자로 해석할 수 없는 동적 가져오기는 빈 문자열
    specifier: string;
    // 해석된 대상 파일 절대 경로로 외부 패키지와 해석 실패는 없음
    target: string | undefined;
    // 형식 위치에서만 쓰여 실행 시 지워지는 가져오기 여부
    typeOnly: boolean;
}>;

// 안쪽 계층이 바깥 계층과 프레임워크를 모르도록 고정한 계층별 의존 규칙
const POLICY: Readonly<Record<Layer, Policy>> = {
    // 공통 계약은 다른 계층을 모름
    shared: { runtime: [], types: [], packages: [] },
    // 정형 규정 데이터는 공통 계약만 앎
    "rules/data": { runtime: ["shared"], types: [], packages: ["node:"] },
    // 규정 판정 로직은 공통 계약만 앎
    "rules/engine": { runtime: ["shared"], types: [], packages: ["node:"] },
    // 유스케이스와 포트는 규정과 공통 계약만 알고 프레임워크를 모름
    application: {
        runtime: ["shared", "rules/data", "rules/engine"],
        types: [],
        packages: ["node:"]
    },
    // DB 스키마와 연결은 공통 계약과 DB 드라이버만 앎
    database: { runtime: ["shared"], types: [], packages: ["drizzle-orm", "postgres"] },
    // 포트 구현은 안쪽 계층과 질의 도구 및 객체 저장소를 알고 DB 드라이버 연결은 데이터베이스 계층에 맡김
    adapters: {
        runtime: ["shared", "rules/data", "rules/engine", "application", "database"],
        types: [],
        packages: ["drizzle-orm", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "node:"]
    },
    // HTTP 처리기는 유스케이스와 공통 계약만 앎
    apis: { runtime: ["shared", "application"], types: [], packages: ["node:"] },
    // 조립 지점은 서버 계층을 연결하고 HTTP 처리기는 의존 형식만 앎
    bootstrap: {
        runtime: [
            "shared",
            "rules/data",
            "rules/engine",
            "application",
            "database",
            "adapters",
            "constant"
        ],
        types: ["apis"],
        packages: ["@aws-sdk/client-s3", "node:"]
    },
    // 라우트는 화면과 HTTP 처리기와 조립 지점만 앎
    app: { runtime: ["views", "apis", "bootstrap"], types: [], packages: ["next", "react"] },
    // 페이지 조립은 화면 부품과 서버 계약 형식만 앎
    views: {
        runtime: ["components", "assets", "constant"],
        types: ["shared", "application"],
        packages: ["next", "react"]
    },
    // 화면 부품은 상수와 자원 및 서버 계약 형식만 앎
    components: {
        runtime: ["constant", "assets"],
        types: ["shared", "application"],
        packages: ["next", "react"]
    },
    // 화면 상수는 서버 계약 형식만 앎
    constant: { runtime: [], types: ["shared", "application"], packages: [] },
    // 이미지 자원은 다른 계층을 모름
    assets: { runtime: [], types: [], packages: [] },
    // 전역 스타일은 다른 계층을 모름
    styles: { runtime: [], types: [], packages: [] }
};

// 표현 계층끼리만 주고받는 화면 자원 확장자
const RESOURCE = /\.(css|png|jpe?g|webp|svg|gif|ico)$/;

// 화면 자원을 가져오거나 담을 수 있는 표현 계층
const PRESENTATION: readonly Layer[] = ["app", "views", "components", "assets", "styles"];

// 원본 밖 파일을 가져오는 문서화된 예외로 모델 고정값의 단일 원본
const OUTSIDE: ReadonlyMap<string, readonly string[]> = new Map([
    [
        "apps/web/src/rules/engine/admission.ts",
        [
            "experiments/perception/src/replay_perception/model-manifest.json",
            "experiments/perception/src/replay_perception/observer-models.json"
        ]
    ]
]);

// 모듈 대역과 실행 인자를 바꾼 뒤 실행 진입점을 다시 실행하려고 실행 중 가져오기를 쓰는 문서화된 예외
const DEFERRED: ReadonlySet<string> = new Set(["apps/web/test/config/worker-command.test.ts"]);

// 연결 풀을 만드는 유일한 정의 모듈
const FACTORY = join(ROOT, "database/client/index.ts");

// 컴파일러 규칙으로 해석한 저장소 타입 설정으로 별칭과 기호 해석이 함께 사용
const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(join(REPO, "tsconfig.base.json"), ts.sys.readFile).config,
    ts.sys,
    REPO
);

// 기준 폴더 설정이 없어 설정 파일 폴더 기준으로 해석한 경로 별칭별 공개 진입점 절대 경로
const ALIASES: ReadonlyMap<string, string> = new Map(
    Object.entries(config.options.paths ?? {}).map(([alias, [entry = ""]]): [string, string] => [
        alias,
        resolve(REPO, entry)
    ])
);

// 저장소 루트 기준 슬래시 경로 생성
const local = (path: string) => relative(REPO, path).split(sep).join("/");

// 파일이 속한 계층 확인으로 원본 밖이면 없음 반환
const layer = (path: string): Layer | undefined => {
    // 웹 원본 루트 기준 경로
    const inner = relative(ROOT, path).split(sep).join("/");
    // 경로 접두어가 맞는 계층 반환
    return LAYERS.find((name) => inner === name || inner.startsWith(`${name}/`));
};

// 공개 별칭이 있는 계층
const ALIASED: ReadonlySet<Layer | undefined> = new Set([...ALIASES.values()].map(layer));

// 외부 지정자의 패키지 이름 확인으로 내장 모듈은 node 접두어로 통일
const pkg = (specifier: string) => {
    // 내장 모듈 통일
    if (specifier.startsWith("node:")) return "node:";
    // 범위 패키지는 두 조각 일반 패키지는 한 조각 반환
    return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
};

// 지정자가 가리키는 파일 해석으로 외부 패키지와 해석 실패는 없음 반환
const target = (from: string, specifier: string) => {
    // 경로 별칭은 공개 진입점으로 해석
    if (ALIASES.has(specifier)) return ALIASES.get(specifier);
    // 상대 경로가 아니면 외부 패키지
    if (!specifier.startsWith(".")) return undefined;
    // 가져오는 파일 기준 절대 경로
    const base = resolve(dirname(from), specifier);
    // 확장자 생략과 폴더 진입점을 포함한 후보 중 존재하는 첫 파일 반환
    return [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx")
    ].find((path) => existsSync(path) && statSync(path).isFile());
};

// 확장자에 맞는 구문 종류
const kind = (path: string) => {
    // JSX를 담는 TS 모듈
    if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
    // JS 모듈과 TS 모듈 구분 반환
    return /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
};

// 확장자에 맞는 구문 트리 생성
const tree = (from: string, text: string) =>
    ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true, kind(from));

// 원본 문자열의 정적 가져오기와 재내보내기 및 형식 가져오기와 동적 가져오기 수집
const scan = (from: string, text: string): Edge[] => {
    // 구문 트리
    const source = tree(from, text);
    // 수집한 가져오기
    const edges: Edge[] = [];
    // 지정자와 형식 전용 여부를 가져오기로 기록
    const add = (specifier: string, typeOnly: boolean) => {
        // 해석한 대상과 함께 기록
        edges.push({ from, specifier, target: target(from, specifier), typeOnly });
    };
    // 모든 구문 노드 방문
    const visit = (node: ts.Node): void => {
        // 선언 단위 import type만 지워지고 개별 type 표시는 verbatimModuleSyntax로 실행 가져오기로 남음
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            add(
                node.moduleSpecifier.text,
                node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
            );
        }
        // 재내보내기는 선언 단위 export type만 지워짐
        if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            add(node.moduleSpecifier.text, node.isTypeOnly);
        }
        // 형식 위치의 import 형식은 실행 시 지워짐
        if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            add(node.argument.literal.text, true);
        }
        // 값 위치의 동적 가져오기는 실행 가져오기이며 문자열이 아니면 해석 불가로 기록
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            // 첫 인자
            const [argument] = node.arguments;
            // 문자열 지정자 또는 해석 불가 기록
            add(argument && ts.isStringLiteralLike(argument) ? argument.text : "", false);
        }
        // 하위 노드 방문
        ts.forEachChild(node, visit);
    };
    // 파일 전체 방문
    visit(source);
    return edges;
};

// 폴더 아래 선언 파일을 뺀 TS와 JS 모듈 목록 생성으로 숨김 항목과 설치 폴더 제외
const modules = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        // 항목 절대 경로
        const path = join(folder, entry.name);
        // 숨김 항목과 설치 폴더 제외
        if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
        // 하위 폴더 탐색
        if (entry.isDirectory()) return modules(path);
        // 선언 파일을 뺀 모듈만 포함
        return /\.[cm]?(ts|js)x?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)
            ? [path]
            : [];
    });

// 가져오기 하나의 계층 규칙 위반 사유 확인으로 위반이 없으면 없음 반환
const violation = (edge: Edge): string | undefined => {
    // 가져오는 계층
    const source = layer(edge.from);
    // 계층 밖 원본 거부
    if (!source) return "UNKNOWN_LAYER";
    // 해석할 수 없는 동적 가져오기 거부
    if (!edge.specifier) return "DYNAMIC";
    // 가져오는 계층의 규칙
    const policy = POLICY[source];
    // 대상 파일이 없으면 상대 경로 해석 실패 또는 허용 목록 밖 패키지 거부
    if (!edge.target) {
        // 해석되지 않은 상대 경로 거부
        if (edge.specifier.startsWith(".")) return "UNRESOLVED";
        // 허용 목록 밖 패키지 거부
        return policy.packages.includes(pkg(edge.specifier)) ? undefined : "PACKAGE";
    }
    // 대상 계층
    const destination = layer(edge.target);
    // 원본 밖 파일은 문서화된 예외만 허용
    if (!destination) {
        // 예외 목록 대조
        return OUTSIDE.get(local(edge.from))?.includes(local(edge.target)) ? undefined : "OUTSIDE";
    }
    // 화면 자원은 표현 계층끼리만 허용
    if (RESOURCE.test(edge.target)) {
        // 양쪽 계층 대조
        return PRESENTATION.includes(source) && PRESENTATION.includes(destination)
            ? undefined
            : "RESOURCE";
    }
    // 같은 계층은 자기 별칭을 거치지 않는 상대 경로만 허용
    if (destination === source) return ALIASES.has(edge.specifier) ? "SELF_ALIAS" : undefined;
    // 실행 가져오기 허용 또는 형식 전용 가져오기 허용
    const allowed =
        policy.runtime.includes(destination) ||
        (edge.typeOnly && policy.types.includes(destination));
    // 형식만 허용된 계층의 실행 가져오기와 허용되지 않은 방향 거부
    if (!allowed) return policy.types.includes(destination) ? "RUNTIME" : "LAYER";
    // 별칭이 있는 계층은 정확한 별칭의 공개 진입점으로만 진입
    return ALIASED.has(destination) && !ALIASES.has(edge.specifier) ? "ALIAS" : undefined;
};

// 첫머리 지시문 뒤 선두 묶음에 모듈마다 한 번만 선언하는 가져오기 배치의 위반 사유 목록 생성
const layout = (from: string, text: string): string[] => {
    // 구문 트리
    const source = tree(from, text);
    // 노드 시작 줄 번호
    const line = (node: ts.Node) =>
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    // 발견한 위반 사유
    const found: string[] = [];
    // 이미 선언한 가져오기 지정자
    const seen = new Set<string>();
    // 파일 첫머리 지시문 구간 여부
    let prologue = true;
    // 가져오기가 아닌 본문 시작 여부
    let body = false;
    // 직전 가져오기 선언의 끝 위치
    let end = -1;
    // 최상위 문장 순회
    for (const statement of source.statements) {
        // 첫머리의 연속된 문자열 지시문 구간 유지
        prologue &&=
            ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
        // 지시문은 가져오기 앞에 허용
        if (prologue) continue;
        // 가져오기가 아닌 문장은 본문으로 처리
        if (!ts.isImportDeclaration(statement)) {
            // 본문 시작 기록
            body = true;
            continue;
        }
        // 직전 가져오기와의 사이 문자열
        const between = end < 0 ? "" : text.slice(end, statement.getStart(source));
        // 본문 뒤 가져오기 거부
        if (body) found.push(`LATE:${line(statement)}`);
        // 선두 묶음 안에서 빈 줄로 떨어진 가져오기 거부
        else if (/\n[ \t]*\r?\n/.test(between)) found.push(`GAP:${line(statement)}`);
        // 지정자 문자열
        const specifier = ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : "";
        // 같은 모듈의 두 번째 선언 거부
        if (seen.has(specifier)) found.push(`DUPLICATE:${line(statement)} ${specifier}`);
        // 지정자 기록
        seen.add(specifier);
        // 직전 가져오기 끝 위치 기록
        end = statement.getEnd();
    }
    // 형식 위치의 가져오기와 실행 중 가져오기 방문
    const visit = (node: ts.Node): void => {
        // 형식 위치의 import 형식 거부
        if (ts.isImportTypeNode(node)) found.push(`INLINE:${line(node)}`);
        // 문서화된 예외 밖의 실행 중 가져오기 거부
        if (ts.isCallExpression(node) && !DEFERRED.has(local(from))) {
            // 동적 가져오기 거부
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                found.push(`DYNAMIC:${line(node)}`);
            }
            // CommonJS 가져오기 거부
            if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
                found.push(`REQUIRE:${line(node)}`);
            }
        }
        // 하위 노드 방문
        ts.forEachChild(node, visit);
    };
    // 파일 전체 방문
    visit(source);
    return found;
};

// 가상 원본을 더한 컴파일러 기호 해석으로 연결 생성 기능을 실행 이름으로 묶는 원본인지 판별하는 함수 생성
const opener = (roots: readonly string[], virtual: ReadonlyMap<string, string>) => {
    // 기본 컴파일러 호스트
    const base = ts.createCompilerHost(config.options, true);
    // 가상 원본을 실제 파일보다 먼저 읽는 호스트
    const host: ts.CompilerHost = {
        ...base,
        // 가상 원본 존재 확인
        fileExists: (name) => virtual.has(name) || base.fileExists(name),
        // 가상 원본 문자열 우선 반환
        readFile: (name) => virtual.get(name) ?? base.readFile(name),
        // 가상 원본 구문 트리 우선 생성
        getSourceFile: (name, version, ...rest) => {
            // 가상 원본 문자열
            const text = virtual.get(name);
            // 가상 원본이 없으면 실제 파일 읽음
            if (text === undefined) return base.getSourceFile(name, version, ...rest);
            // 가상 원본 구문 트리 반환
            return ts.createSourceFile(name, text, version, true, kind(name));
        }
    };
    // 실제 원본과 가상 원본을 뿌리로 둔 프로그램
    const program = ts.createProgram({
        rootNames: [...roots, ...virtual.keys()],
        options: config.options,
        host
    });
    // 형식 검사기
    const checker = program.getTypeChecker();
    // 별칭을 끝까지 따라간 실제 기호
    const real = (symbol: ts.Symbol | undefined) =>
        symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    // 정의 모듈 구문 트리
    const definition = program.getSourceFile(FACTORY);
    // 정의 모듈 기호
    const origin = definition && checker.getSymbolAtLocation(definition);
    // 정의 모듈이 공개한 연결 생성 기능 기호
    const factory =
        origin && checker.getExportsOfModule(origin).find((symbol) => symbol.name === "client");
    // 정의가 옮겨지면 판별 기준이 사라지므로 중단
    if (!factory) throw new Error(`${local(FACTORY)} must export client`);
    // 이름 하나가 연결 생성 기능을 가리키는지 확인
    const refers = (name: ts.Identifier) => real(checker.getSymbolAtLocation(name)) === factory;
    // 지정자가 가리키는 모듈이 연결 생성 기능을 공개하는지 확인
    const exposes = (specifier: ts.Expression) => {
        // 지정자가 가리키는 모듈 기호
        const destination = checker.getSymbolAtLocation(specifier);
        // 공개 기호 중 연결 생성 기능 탐색
        return (
            destination !== undefined &&
            checker.getExportsOfModule(destination).some((symbol) => real(symbol) === factory)
        );
    };
    // 원본 하나의 판별 함수 반환
    return (file: string) => {
        // 원본 구문 트리
        const source = program.getSourceFile(file);
        // 프로그램 밖 원본은 판별할 수 없으므로 중단
        if (!source) throw new Error(`${local(file)} is not in the program`);
        // 실행 가져오기 중 연결 생성 기능을 묶는 선언 확인
        return source.statements.some((statement) => {
            // 가져오기 선언만 대상
            if (!ts.isImportDeclaration(statement)) return false;
            // 가져오기 절
            const clause = statement.importClause;
            // 이름 없는 가져오기와 선언 단위 형식 가져오기 제외
            if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
            // 기본 가져오기 이름 확인
            if (clause.name && refers(clause.name)) return true;
            // 묶음 가져오기
            const bindings = clause.namedBindings;
            // 묶음 없는 가져오기 제외
            if (!bindings) return false;
            // 네임스페이스는 대상 모듈의 공개 기호 확인
            if (ts.isNamespaceImport(bindings)) return exposes(statement.moduleSpecifier);
            // 형식 표시 없는 이름 가져오기 확인
            return bindings.elements.some((element) => !element.isTypeOnly && refers(element.name));
        });
    };
};

// 실행 가져오기 그래프의 강한 연결 요소 중 순환 파일 묶음 반환
const cycles = (graph: ReadonlyMap<string, readonly string[]>) => {
    // 방문 순서 번호
    const order = new Map<string, number>();
    // 도달 가능한 가장 이른 방문 번호
    const low = new Map<string, number>();
    // 현재 탐색 중인 파일 더미
    const stack: string[] = [];
    // 더미에 남은 파일
    const open = new Set<string>();
    // 발견한 순환 묶음
    const found: string[][] = [];
    // 파일 하나에서 시작하는 깊이 우선 탐색
    const visit = (file: string): void => {
        // 방문 번호 부여
        order.set(file, order.size);
        // 가장 이른 방문 번호 초기화
        low.set(file, order.get(file) ?? 0);
        // 탐색 더미에 추가
        stack.push(file);
        // 열린 파일 표시
        open.add(file);
        // 실행 가져오기 대상 순회
        for (const next of graph.get(file) ?? []) {
            // 처음 만난 대상은 먼저 탐색 후 가장 이른 번호 갱신
            if (!order.has(next)) {
                // 대상 탐색
                visit(next);
                // 대상이 도달한 번호 반영
                low.set(file, Math.min(low.get(file) ?? 0, low.get(next) ?? 0));
            } else if (open.has(next)) {
                // 더미에 남은 대상의 방문 번호 반영
                low.set(file, Math.min(low.get(file) ?? 0, order.get(next) ?? 0));
            }
        }
        // 연결 요소의 시작 파일이 아니면 종료
        if (low.get(file) !== order.get(file)) return;
        // 연결 요소 파일 묶음
        const group: string[] = [];
        // 시작 파일까지 더미에서 꺼냄
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
            // 열린 표시 해제
            open.delete(member);
            // 묶음에 추가
            group.push(member);
            // 시작 파일에서 중단
            if (member === file) break;
        }
        // 둘 이상이거나 자기 자신을 가져오는 묶음만 순환으로 기록
        if (group.length > 1 || graph.get(file)?.includes(file)) found.push(group.sort());
    };
    // 모든 파일 탐색
    for (const file of graph.keys()) if (!order.has(file)) visit(file);
    return found.sort();
};

// 검사 대상 원본 파일로 테스트 제외
const SOURCES = modules(ROOT).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

// 가져오기 배치를 검사할 웹 앱과 실행 스크립트 및 테스트 설정의 모든 모듈
const MODULES = [
    ...modules(resolve("apps/web")),
    ...modules(resolve("scripts")),
    resolve("vitest.config.ts")
];

// 검사 대상 원본 파일 집합
const KNOWN: ReadonlySet<string> = new Set(SOURCES);

// 원본 전체 가져오기
const EDGES = SOURCES.flatMap((file) => scan(file, readFileSync(file, "utf8")));

// 원본 파일 사이 실행 가져오기 그래프
const GRAPH: ReadonlyMap<string, readonly string[]> = new Map(
    SOURCES.map((file) => [
        file,
        EDGES.flatMap((edge) =>
            edge.from === file && !edge.typeOnly && edge.target && KNOWN.has(edge.target)
                ? [edge.target]
                : []
        )
    ])
);

// 원본 루트 기준 경로와 지정자로 규칙 대조용 가져오기 생성
const link = (from: string, specifier: string, typeOnly: boolean): Edge => {
    // 가져오는 파일 절대 경로
    const file = resolve(ROOT, from);
    // 실제 해석 규칙을 적용한 가져오기 반환
    return { from: file, specifier, target: target(file, specifier), typeOnly };
};

// 연결 생성 기능을 다른 계층에서 다시 내보내 별칭 사슬을 만드는 가상 중계 모듈
const RELAY = join(ROOT, "bootstrap/relay.ts");

// 가상 원본 문자열과 연결 생성 기능 결속 기대 결과
const BINDINGS: readonly (readonly [string, boolean])[] = [
    [`import { client } from "@replay/database";`, true],
    [`import { client as open } from "@replay/database";`, true],
    [`import * as database from "@replay/database";`, true],
    [`import { client } from "../database/client";`, true],
    [`import { client } from "./relay";`, true],
    [`import open from "./relay";`, true],
    [`import * as schema from "../database/schema/tables";`, false],
    [`import type { DatabaseClient } from "@replay/database";`, false],
    [`import { type client } from "@replay/database";`, false],
    [`import { client } from "@replay/adapters";`, false]
];

// 판별 사례별 가상 원본 경로
const probe = (index: number) => join(ROOT, `bootstrap/probe${index}.ts`);

// 중계 모듈과 판별 사례를 담은 가상 원본
const PROBES: ReadonlyMap<string, string> = new Map([
    [RELAY, `export { client, client as default } from "@replay/database";`],
    ...BINDINGS.map(([text], index): [string, string] => [probe(index), text])
]);

// 실제 원본과 가상 원본을 한 프로그램으로 해석한 연결 생성 기능 결속 판별
const opens = opener(SOURCES, PROBES);

describe("web architecture", () => {
    it("scans every source layer through the real tsconfig aliases", () => {
        // 계층 밖 원본 파일 없음 확인
        expect(SOURCES.filter((file) => !layer(file)).map(local)).toEqual([]);
        // CSS만 가진 전역 스타일을 뺀 모든 계층에서 원본을 읽음 확인
        expect(new Set(SOURCES.map(layer))).toEqual(
            new Set(LAYERS.filter((name) => name !== "styles"))
        );
        // 별칭마다 해당 계층 폴더 바로 아래의 실제 진입점을 가리킴 확인
        expect(
            [...ALIASES.values()].filter(
                (entry) =>
                    !existsSync(entry) || entry !== join(ROOT, layer(entry) ?? "", "index.ts")
            )
        ).toEqual([]);
    });

    it("treats only declaration level type imports as erased under verbatim module syntax", () => {
        // 가져오기 형태별 원본 문자열
        const text = [
            `import type { A } from "@replay/shared-types";`,
            `import { type B } from "@replay/shared-types";`,
            `export type { C } from "@replay/shared-types";`,
            `export { type D } from "@replay/shared-types";`,
            `export * from "@replay/shared-types";`,
            `type E = import("@replay/shared-types").E;`,
            `const f = () => import("@replay/shared-types");`,
            `const g = (name: string) => import(name);`,
            `import "../styles/index.css";`
        ].join("\n");

        // 형태별 지정자와 형식 전용 여부 확인
        expect(
            scan(join(ROOT, "app/probe.tsx"), text).map((edge) => [edge.specifier, edge.typeOnly])
        ).toEqual([
            ["@replay/shared-types", true],
            ["@replay/shared-types", false],
            ["@replay/shared-types", true],
            ["@replay/shared-types", false],
            ["@replay/shared-types", false],
            ["@replay/shared-types", true],
            ["@replay/shared-types", false],
            ["", false],
            ["../styles/index.css", false]
        ]);
    });

    it("keeps every import inside its layer policy and public entry", () => {
        // 위반 가져오기와 사유 목록
        const found = EDGES.flatMap((edge) => {
            // 위반 사유
            const reason = violation(edge);
            // 위반만 경로와 함께 기록
            return reason ? [`${local(edge.from)} -> ${edge.specifier} ${reason}`] : [];
        });

        // 위반 없음 확인
        expect(found).toEqual([]);
    });

    it("has no runtime import cycles", () => {
        // 실행 순환 없음 확인
        expect(cycles(GRAPH).map((group) => group.map(local))).toEqual([]);
    });

    it("finds cycles and self imports in a runtime graph", () => {
        // 둘이 서로 가져오는 묶음과 자기 가져오기 및 순환 밖 진입 파일을 담은 그래프
        const graph = new Map([
            ["a", ["b"]],
            ["b", ["a"]],
            ["c", ["c"]],
            ["d", ["a"]]
        ]);

        // 순환 묶음만 찾음 확인
        expect(cycles(graph)).toEqual([["a", "b"], ["c"]]);
    });

    it.each<[string, string, boolean, string]>([
        ["application/use-cases/probe.ts", "drizzle-orm", true, "PACKAGE"],
        ["application/use-cases/probe.ts", "../../adapters/job-store", true, "LAYER"],
        ["rules/engine/probe.ts", "@replay/application", true, "LAYER"],
        ["rules/engine/probe.ts", "@replay/rule-data", false, "LAYER"],
        ["adapters/probe.ts", "../application/use-cases/incidents/plan", false, "ALIAS"],
        ["bootstrap/probe.ts", "../adapters/incidents", false, "ALIAS"],
        ["components/probe.tsx", "@replay/application", false, "RUNTIME"],
        ["bootstrap/probe.ts", "../apis/job", false, "RUNTIME"],
        ["views/probe.tsx", "@replay/database", true, "LAYER"],
        ["app/probe.tsx", "@replay/adapters", false, "LAYER"],
        ["application/probe.ts", "@replay/application", false, "SELF_ALIAS"],
        ["application/probe.ts", "../components/Header/style.css", false, "RESOURCE"],
        [
            "rules/engine/probe.ts",
            "../../../../../experiments/perception/src/replay_perception/model-manifest.json",
            false,
            "OUTSIDE"
        ],
        ["application/probe.ts", "./missing", false, "UNRESOLVED"],
        ["shared/probe.ts", "node:crypto", false, "PACKAGE"],
        ["adapters/probe.ts", "postgres", false, "PACKAGE"]
    ])("rejects %s importing %s", (from, specifier, typeOnly, reason) => {
        // 금지된 가져오기의 위반 사유 확인
        expect(violation(link(from, specifier, typeOnly))).toBe(reason);
    });

    it.each<[string, string, boolean]>([
        ["adapters/probe.ts", "@replay/application", false],
        ["components/probe.tsx", "@replay/application", true],
        ["bootstrap/probe.ts", "../apis/job", true],
        ["app/probe.tsx", "../components/Header/style.css", false],
        [
            "rules/engine/admission.ts",
            "../../../../../experiments/perception/src/replay_perception/observer-models.json",
            false
        ],
        ["application/use-cases/probe.ts", "./incidents/plan", false]
    ])("accepts %s importing %s", (from, specifier, typeOnly) => {
        // 허용된 가져오기의 위반 없음 확인
        expect(violation(link(from, specifier, typeOnly))).toBeUndefined();
    });

    it("declares every import once in the leading block of each module", () => {
        // 파일별 가져오기 배치 위반
        const found = MODULES.flatMap((file) =>
            layout(file, readFileSync(file, "utf8")).map((reason) => `${local(file)} ${reason}`)
        );

        // 웹 앱과 스크립트 및 테스트 설정 모두 읽음 확인
        expect(MODULES.map(local)).toEqual(
            expect.arrayContaining([
                "apps/web/next.config.ts",
                "scripts/worker.mjs",
                "vitest.config.ts"
            ])
        );
        // 위반 없음 확인
        expect(found).toEqual([]);
    });

    it("rejects spaced duplicate late inline and runtime imports after leading directives", () => {
        // 위반 형태별 원본 문자열
        const text = [
            `"use client";`,
            `import { a } from "./a";`,
            ``,
            `import type { B } from "./b";`,
            `import { c } from "./a";`,
            `const d = 1;`,
            `import { e } from "./e";`,
            `type F = import("./f").F;`,
            `const g = () => import("./g");`,
            `const h = require("./h");`
        ].join("\n");

        // 지시문을 허용하고 위반 사유와 줄 번호를 기록함 확인
        expect(layout(join(ROOT, "components/probe.tsx"), text)).toEqual([
            "GAP:4",
            "DUPLICATE:5 ./a",
            "LATE:7",
            "INLINE:8",
            "DYNAMIC:9",
            "REQUIRE:10"
        ]);
        // 문서화된 예외 파일의 실행 중 가져오기 허용 확인
        expect(
            layout(resolve("apps/web/test/config/worker-command.test.ts"), `await import("./x");`)
        ).toEqual([]);
    });

    it("opens the database pool only in the process runtime", () => {
        // 데이터베이스 드라이버를 실행 가져오기로 부르는 원본 파일
        const drivers = EDGES.filter(
            (edge) => !edge.typeOnly && pkg(edge.specifier) === "postgres"
        ).map((edge) => local(edge.from));
        // 연결 생성 기능을 실행 이름으로 묶는 원본 파일
        const owners = SOURCES.filter((file) => opens(file)).map(local);

        // 드라이버는 연결 생성 기능 정의 모듈 하나만 앎 확인
        expect(drivers).toEqual([local(FACTORY)]);
        // 프로세스 공용 연결 소유 파일 하나만 확인
        expect(owners).toEqual(["apps/web/src/bootstrap/runtime.ts"]);
    });

    it.each(
        BINDINGS.map(([text, expected], index) => ({ text, expected, file: probe(index) }))
    )("judges pool creation for $text", ({ expected, file }) => {
        // 별칭 사슬을 끝까지 따라간 연결 생성 기능 결속 판별 확인
        expect(opens(file)).toBe(expected);
    });
});
