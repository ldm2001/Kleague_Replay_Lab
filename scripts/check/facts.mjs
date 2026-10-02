#!/usr/bin/env node
// 라벨 사실 키와 승인 어휘의 일치 검증
import { readFileSync } from "node:fs";
// 파일 경로 도구 가져오기
import { join, relative } from "node:path";
// 승인 키를 소유한 관측 키 상수 가져오기
import { INCIDENT_OBSERVATION_KEYS } from "../../apps/web/src/shared/incident.ts";

// 검사할 코드의 기준 폴더 지정
const ROOT = new URL("../../", import.meta.url).pathname;
// 라벨 자료가 다루는 행위 유형 지정
const ACTION = "HOLDING_MOTION";
// 승인 계층이 관측 사실에 붙이는 접두어 지정
const PREFIX = "observations.";

// 관측 키에 승인 접두어를 붙인 기준 집합 생성
const expected = INCIDENT_OBSERVATION_KEYS[ACTION].map((key) => `${PREFIX}${key}`);
// 확인된 자료 오류 목록 초기화
const problems = [];

// 검사 대상 파일 읽음
const source = (path) => readFileSync(join(ROOT, path), "utf8");

// 라벨 실행 검사의 사실 목록 읽음
function runtimeFacts(path) {
    // 사실 목록 선언 구간 확인
    const block = source(path).match(/^FACTS = \(([\s\S]*?)\)/m);
    // 선언을 찾지 못하면 미확인 반환
    if (block === null) return null;
    // 선언 구간 안의 문자열 값 반환
    return [...block[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

// 입력 스키마가 참조하는 사실 키 목록 읽음
function schemaFacts(path) {
    // 사실 키 정의의 허용 값 확인
    const values = JSON.parse(source(path)).$defs?.fact?.enum;
    // 목록이 아니면 미확인 반환
    return Array.isArray(values) ? values : null;
}

// 라벨 계약 문서의 사실 키 나열 읽음
function contractFacts(path) {
    // 사실 키를 나열한 줄 확인
    const line = source(path).split("\n").find((entry) => entry.startsWith("- `factKey`:"));
    // 나열을 찾지 못하면 미확인 반환
    if (line === undefined) return null;
    // 필드 이름 뒤의 강조 문자열 값 반환
    return [...line.slice(line.indexOf(":") + 1).matchAll(/`([^`]*)`/g)].map((match) => match[1]);
}

// 기준 집합과 어긋난 사실 키를 사유와 함께 수집
function compare(path, keys) {
    // 목록을 찾지 못한 경우 보고
    if (keys === null) {
        // 확인된 자료 오류 목록에 현재 항목 추가
        problems.push(`${path}  사실 키 목록을 찾지 못함`);
        // 현재 처리 종료
        return;
    }
    // 승인 어휘에 없는 키 수집
    for (const key of keys) {
        // 기준 집합 및 키의 조건에 따라 처리 분기
        if (!expected.includes(key)) problems.push(`${path}  승인 어휘에 없는 사실 키 "${key}"`);
    }
    // 승인 어휘에 있으나 라벨에서 빠진 키 수집
    for (const key of expected) {
        // 기준 집합 및 키의 조건에 따라 처리 분기
        if (!keys.includes(key)) problems.push(`${path}  라벨에서 빠진 승인 사실 키 "${key}"`);
    }
}

// 같은 어휘를 복사해 둔 라벨 쪽 지점 목록 지정
const sources = [
    ["apps/video-worker/src/replay_video/validation.py", runtimeFacts],
    ["datasets/labeled-cases/holding-labels.schema.json", schemaFacts],
    ["datasets/labeled-cases/holding-predictions.schema.json", schemaFacts],
    ["datasets/labeled-cases/README.md", contractFacts]
];

// 라벨 쪽 지점의 각 항목을 순서대로 검사
for (const [path, read] of sources) compare(path, read(path));

// 확인된 자료 오류 목록의 조건에 따라 처리 분기
if (problems.length > 0) {
    // 실패 내용을 오류 출력으로 전달
    console.error("라벨 사실 키가 승인 어휘와 어긋났습니다. 소유자는 incident.ts의 관측 키입니다.\n");
    // 확인된 자료 오류 목록의 각 항목을 순서대로 검사
    for (const problem of problems) console.error(`  ${problem}`);
    // 실패 내용을 오류 출력으로 전달
    console.error(`\n기준: ${expected.join(", ")}`);
    // 검사 실패를 실행 종료 코드로 전달
    process.exit(1);
}

// 처리 결과 출력
console.log(
    `사실 어휘 확인 — ${ACTION} 사실 ${expected.length}개, ` +
        `라벨 쪽 지점 ${sources.length}개, 기준은 ` +
        `${relative(ROOT, join(ROOT, "apps/web/src/shared/incident.ts"))}`
);
