#!/usr/bin/env node
// 룰 엔진의 판본 문자열 검증
import { readdirSync, readFileSync, statSync } from "node:fs";
// 파일 경로 도구 가져오기
import { join, relative } from "node:path";

// 검사할 코드의 기준 폴더 지정
const ROOT = new URL("../../", import.meta.url).pathname;
// 규정 검사 대상 폴더 지정
const TARGET = join(ROOT, "apps/web/src/rules/engine");
// 판본 표기의 허용 형식 정의
const EDITION = /\b20\d{2}\s*[-/]\s*\d{2}\b/g;

// 검사할 소스 파일 경로 수집
const tree = (dir) =>
    readdirSync(dir).flatMap((entry) => {
        // 영상 전체 처리 여부 확인
        const full = join(dir, entry);
        // 조건에 맞는 결과와 대체 결과 중 하나를 선택해 반환
        return statSync(full).isDirectory() ? tree(full) : [full];
    });

// 계약에 맞지 않는 항목 목록 초기화
const violations = [];

// 대상 파일과 항목을 순서대로 검사
for (const file of tree(TARGET).filter((f) => f.endsWith(".ts"))) {
    // 검사 대상 파일의 줄 목록 읽음
    const lines = readFileSync(file, "utf8").split("\n");
    // 각 코드 줄에서 판본 직접 표기를 검사
    lines.forEach((line, index) => {
        // 대상 파일과 항목을 순서대로 검사
        for (const match of line.matchAll(EDITION)) {
            // 계약에 맞지 않는 항목 목록 목록에 현재 항목 추가
            violations.push(`${relative(ROOT, file)}:${index + 1}  ${match[0]}  ${line.trim()}`);
        }
    });
}

// 계약에 맞지 않는 항목 목록의 조건에 따라 처리 분기
if (violations.length > 0) {
    // 실패 내용을 오류 출력으로 전달
    console.error("엔진 소스에 판본 문자열이 있습니다. 판본 차이는 rule-data가 소유합니다.\n");
    // 계약에 맞지 않는 항목 목록의 각 항목을 순서대로 검사
    for (const violation of violations) console.error(`  ${violation}`);
    // 검사 실패를 실행 종료 코드로 전달
    process.exit(1);
}

// 처리 결과 출력
console.log(`판본 리터럴 없음 — ${relative(ROOT, TARGET)}`);
