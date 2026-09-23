#!/usr/bin/env node
// 픽스처와 규정 데이터의 어휘 검증
import { readdirSync, readFileSync } from "node:fs";
// 파일 경로 도구 가져오기
import { join } from "node:path";
// 공통 상태 값 목록 가져오기
import * as vocabulary from "../../apps/web/src/shared/vocabulary.ts";

// 검사할 코드의 기준 폴더 지정
const ROOT = new URL("../../", import.meta.url).pathname;
// 규정 평가 사례 파일 목록 지정
const FIXTURES = join(ROOT, "apps/web/src/rules/engine/fixtures");
// 실행 규정 자료 폴더 지정
const RULE_DATA = join(ROOT, "apps/web/src/rules/data");

// 공유 어휘 수집
const allowed = new Set();
// 값 목록 및 허용된 상태 값 목록의 각 항목을 순서대로 검사
for (const value of Object.values(vocabulary)) {
    // 배열과 일반 객체의 검증 경로 분리
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        // 값의 각 항목을 순서대로 검사
        for (const entry of value) allowed.add(entry);
    }
}

// 규정 데이터 파일 수집
const tree = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        // 영상 전체 처리 여부 확인
        const full = join(dir, entry.name);
        // 하위 폴더이면 내부 파일을 재귀 조회
        if (entry.isDirectory()) return tree(full);
        // 조건에 맞는 결과와 대체 결과 중 하나를 선택해 반환
        return entry.name.endsWith(".json") ? [full] : [];
    });

// 실행 규정 자료 파일 목록 확인
const ruleDataFiles = tree(RULE_DATA);
// 사용 가능한 판본 식별자 목록 보관 공간 생성
const knownVersions = new Set(
    ruleDataFiles.map((file) => JSON.parse(readFileSync(file, "utf8")).versionId),
);

// 확인된 자료 오류 목록 초기화
const problems = [];

// 판본 데이터 필드별 제약
const RULE_DATA_FIELDS = [
    { path: ["timeWindowExceptions", "sendOffCategories"], vocabulary: "VAR_WINDOW_EXCEPTIONS" },
];

// 실행 규정 자료 파일 목록의 각 항목을 순서대로 검사
for (const file of ruleDataFiles) {
    // 불러온 자료 읽음
    const data = JSON.parse(readFileSync(file, "utf8"));
    // 대상 파일과 항목을 순서대로 검사
    for (const { path, vocabulary: name } of RULE_DATA_FIELDS) {
        // 값 목록 확인
        const values = path.reduce((node, key) => node?.[key], data);
        // 필드 없음
        if (!Array.isArray(values)) continue;
        // 해당 규정 필드에서 허용하는 상태 값의 집합 생성
        const permitted = new Set(vocabulary[name]);
        // 값 목록의 각 항목을 순서대로 검사
        for (const value of values) {
            // 질문에 사용할 수 있는 후보 목록 및 값의 조건에 따라 처리 분기
            if (!permitted.has(value)) {
                // 확인된 자료 오류 목록 목록에 현재 항목 추가
                problems.push(`${data.versionId}:${path.join(".")}  ${name}에 없는 값 "${value}"`);
            }
        }
    }
}

// 픽스처 문자열 값 수집
const strings = (node, path, into) => {
    // 현재 재귀 검사 항목의 조건에 따라 처리 분기
    if (typeof node === "string") {
        // 문자열 검사 결과 목록 목록에 현재 항목 추가
        into.push([path, node]);
        // 현재 처리 종료
        return;
    }
    // 배열과 일반 객체의 검증 경로 분리
    if (Array.isArray(node)) {
        // 자료 안의 문자열을 경로와 함께 재귀 수집
        node.forEach((entry, index) => strings(entry, `${path}[${index}]`, into));
        // 현재 처리 종료
        return;
    }
    // 현재 재귀 검사 항목의 조건에 따라 처리 분기
    if (node !== null && typeof node === "object") {
        // 항목 이름과 값의 묶음 및 현재 재귀 검사 항목의 각 항목을 순서대로 검사
        for (const [key, value] of Object.entries(node)) {
            // 자유 문자열
            if (key === "shotIds") continue;
            // 자료 안의 문자열을 경로와 함께 재귀 수집
            strings(value, `${path}.${key}`, into);
        }
    }
};

// 대상 파일과 항목을 순서대로 검사
for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
    // 검증할 사례 묶음 읽음
    const suite = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
    // 검사할 문자열과 자료 경로 목록 초기화
    const found = [];

    // 자료 안의 문자열을 경로와 함께 재귀 수집
    strings(suite.baseline, `${file}:baseline`, found);
    // 검증할 사례 묶음의 각 항목을 순서대로 검사
    for (const testCase of suite.cases) {
        // 자료 안의 문자열을 경로와 함께 재귀 수집
        strings(testCase.given.facts, `${file}:${testCase.id}.given.facts`, found);
        // 자료 안의 문자열을 경로와 함께 재귀 수집
        strings(testCase.expect, `${file}:${testCase.id}.expect`, found);

        // 확인할 버전 계산
        const version = testCase.given.ruleVersion ?? suite.defaults?.ruleVersion;
        // 확인할 버전 및 사용 가능한 판본 식별자 목록의 조건에 따라 처리 분기
        if (version !== undefined && !knownVersions.has(version)) {
            // 확인된 자료 오류 목록 목록에 현재 항목 추가
            problems.push(`${file}:${testCase.id}  알 수 없는 판본 "${version}"`);
        }
    }

    // 조건에 맞는 조회 결과의 각 항목을 순서대로 검사
    for (const [path, value] of found) {
        // 값의 조건에 따라 처리 분기
        if (!allowed.has(value)) problems.push(`${path}  어휘에 없는 값 "${value}"`);
    }
}

// 확인된 자료 오류 목록의 조건에 따라 처리 분기
if (problems.length > 0) {
    // 실패 내용을 오류 출력으로 전달
    console.error("픽스처가 타입보다 앞서 나갔습니다.\n");
    // 확인된 자료 오류 목록의 각 항목을 순서대로 검사
    for (const problem of problems) console.error(`  ${problem}`);
    // 실패 내용을 오류 출력으로 전달
    console.error("\n값을 먼저 vocabulary.ts에 추가하거나 픽스처의 오타를 고치세요.");
    // 검사 실패를 실행 종료 코드로 전달
    process.exit(1);
}

// 처리 결과 출력
console.log(
    `어휘 확인 — 알려진 값 ${allowed.size}개, 판본 ${knownVersions.size}개, ` +
        `판본 데이터 필드 ${RULE_DATA_FIELDS.length}개`,
);
