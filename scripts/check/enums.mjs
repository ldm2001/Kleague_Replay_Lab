#!/usr/bin/env node
/**
 * 픽스처에 쓰인 값이 shared-types의 어휘에 있는지 검사한다.
 *
 * 픽스처는 JSON이고 러너가 이중 단언으로 넘기므로 tsc가 값을 보지 않는다.
 * 이 검사가 없으면 오타 하나가 "타입에 없는 값을 기대하는 케이스"로 남고,
 * 그 케이스는 통과하는 동안 아무것도 지키지 않는다 (README 13절).
 *
 * 판본 데이터도 같은 이유로 tsc 밖에 있다 — ruleSet이 `as RuleSetFile`로
 * 받으므로 값은 아무도 보지 않는다. 그래서 필드별 제약을 따로 검사한다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vocabulary from "../../apps/web/src/shared/vocabulary.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const FIXTURES = join(ROOT, "apps/web/src/rules/engine/fixtures");
const RULE_DATA = join(ROOT, "apps/web/src/rules/data");

/** 어휘 = vocabulary.ts가 내보내는 모든 문자열 배열의 합집합 */
const allowed = new Set();
for (const value of Object.values(vocabulary)) {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    for (const entry of value) allowed.add(entry);
  }
}

/** data/ 아래는 권한별 디렉터리로 나뉘므로 재귀로 훑는다. */
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

/**
 * 판본 데이터의 필드별 어휘 제약.
 *
 * 합집합 검사로는 잡히지 않는 것을 잡는다. DOGSO는 SEND_OFF_CATEGORIES에
 * 있으므로 합집합에는 들어 있지만 창을 다시 여는 사유는 아니다. 엔진은 이
 * 목록의 값을 변환표 없이 그대로 windowException으로 쓰므로, 목록이
 * VAR_WINDOW_EXCEPTIONS를 벗어나면 데이터가 엔진에 표현 불가능한 값을
 * 요구하게 된다. 지금 데이터가 맞는 건 우연이지 검사된 결과가 아니었다.
 */
const RULE_DATA_FIELDS = [
  { path: ["timeWindowExceptions", "sendOffCategories"], vocabulary: "VAR_WINDOW_EXCEPTIONS" },
];

for (const file of ruleDataFiles) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const { path, vocabulary: name } of RULE_DATA_FIELDS) {
    const values = path.reduce((node, key) => node?.[key], data);
    if (!Array.isArray(values)) continue; // 없는 필드는 스키마의 일이다
    const permitted = new Set(vocabulary[name]);
    for (const value of values) {
      if (!permitted.has(value)) {
        problems.push(`${data.versionId}:${path.join(".")}  ${name}에 없는 값 "${value}"`);
      }
    }
  }
}

/** 사실값과 기대값 안의 문자열만 본다. id·note·concern·gate는 사람이 읽는 메모다. */
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
      if (key === "shotIds") continue; // 자유 문자열 — 어휘가 아니다
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
