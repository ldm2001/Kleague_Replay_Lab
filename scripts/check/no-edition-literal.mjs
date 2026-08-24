#!/usr/bin/env node
/**
 * 룰 엔진 소스에 판본 문자열이 있으면 실패한다.
 *
 * 판본별 차이는 web/src/rules/data의 JSON이 소유한다 (README 3절·11절).
 * 엔진이 판본을 알면 규정 개정이 코드 배포와 묶이고, 개정 시점에
 * 고쳐야 할 곳이 데이터 한 곳이 아니라 데이터와 분기 양쪽이 된다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const TARGET = join(ROOT, "web/src/rules/engine");
const EDITION = /\b20\d{2}\s*[-/]\s*\d{2}\b/g;

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const violations = [];

for (const file of walk(TARGET).filter((f) => f.endsWith(".ts"))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(EDITION)) {
      violations.push(`${relative(ROOT, file)}:${index + 1}  ${match[0]}  ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error("엔진 소스에 판본 문자열이 있습니다. 판본 차이는 rule-data가 소유합니다.\n");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`판본 리터럴 없음 — ${relative(ROOT, TARGET)}`);
