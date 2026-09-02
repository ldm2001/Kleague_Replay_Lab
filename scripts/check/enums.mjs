#!/usr/bin/env node
// 픽스처와 규정 데이터의 어휘 검증
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vocabulary from "../../apps/web/src/shared/vocabulary.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const FIXTURES = join(ROOT, "apps/web/src/rules/engine/fixtures");
const RULE_DATA = join(ROOT, "apps/web/src/rules/data");

// 공유 어휘 수집
const allowed = new Set();
for (const value of Object.values(vocabulary)) {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    for (const entry of value) allowed.add(entry);
  }
}

// 규정 데이터 파일 수집
const tree = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tree(full);
    return entry.name.endsWith(".json") ? [full] : [];
  });

const ruleDataFiles = tree(RULE_DATA);
const knownVersions = new Set(
  ruleDataFiles.map((file) => JSON.parse(readFileSync(file, "utf8")).versionId),
);

const problems = [];

// 판본 데이터 필드별 제약
const RULE_DATA_FIELDS = [
  { path: ["timeWindowExceptions", "sendOffCategories"], vocabulary: "VAR_WINDOW_EXCEPTIONS" },
];

for (const file of ruleDataFiles) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const { path, vocabulary: name } of RULE_DATA_FIELDS) {
    const values = path.reduce((node, key) => node?.[key], data);
    // 필드 없음
    if (!Array.isArray(values)) continue;
    const permitted = new Set(vocabulary[name]);
    for (const value of values) {
      if (!permitted.has(value)) {
        problems.push(`${data.versionId}:${path.join(".")}  ${name}에 없는 값 "${value}"`);
      }
    }
  }
}

// 픽스처 문자열 값 수집
const strings = (node, path, into) => {
  if (typeof node === "string") {
    into.push([path, node]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, index) => strings(entry, `${path}[${index}]`, into));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      // 자유 문자열
      if (key === "shotIds") continue;
      strings(value, `${path}.${key}`, into);
    }
  }
};

for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
  const suite = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
  const found = [];

  strings(suite.baseline, `${file}:baseline`, found);
  for (const testCase of suite.cases) {
    strings(testCase.given.facts, `${file}:${testCase.id}.given.facts`, found);
    strings(testCase.expect, `${file}:${testCase.id}.expect`, found);

    const version = testCase.given.ruleVersion ?? suite.defaults?.ruleVersion;
    if (version !== undefined && !knownVersions.has(version)) {
      problems.push(`${file}:${testCase.id}  알 수 없는 판본 "${version}"`);
    }
  }

  for (const [path, value] of found) {
    if (!allowed.has(value)) problems.push(`${path}  어휘에 없는 값 "${value}"`);
  }
}

if (problems.length > 0) {
  console.error("픽스처가 타입보다 앞서 나갔습니다.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\n값을 먼저 vocabulary.ts에 추가하거나 픽스처의 오타를 고치세요.");
  process.exit(1);
}

console.log(
  `어휘 확인 — 알려진 값 ${allowed.size}개, 판본 ${knownVersions.size}개, ` +
    `판본 데이터 필드 ${RULE_DATA_FIELDS.length}개`,
);
