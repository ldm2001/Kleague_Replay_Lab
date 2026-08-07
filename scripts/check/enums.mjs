#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 어휘의 SSOT
// 예전엔 README와 계획 문서를 근거로 썼지만 소유자가 코드로 넘어옴
const VOCABULARY = 'packages/shared-types/src/vocabulary.ts';

const FIXTURE_DIR = 'packages/rule-engine/fixtures';

// 검사에서 빼는 키
// 픽스처 파일을 설명하는 값이라 도메인 어휘가 아님
const META_KEYS = new Set(['suite', 'assertion_mode', 'fixture_schema_version']);

// 세 글자 이상 대문자만 열거형 값으로 봄
const ENUM_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

// vocabulary.ts의 as const 배열을 이름별로 읽음
// 부분문자열 대조가 아니라 원소 단위로 봐야 오탐과 미탐이 같이 사라짐
export function loadVocabulary() {
  const src = readFileSync(join(ROOT, VOCABULARY), 'utf8');
  const groups = {};
  for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[([\s\S]*?)\] as const;/g)) {
    groups[m[1]] = [...m[2].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]);
  }
  return groups;
}

// 픽스처를 재귀로 훑으며 열거형으로 보이는 문자열을 모음
function collectEnumValues(node, key, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectEnumValues(v, key, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectEnumValues(v, k, out);
  } else if (typeof node === 'string' && ENUM_SHAPE.test(node) && !META_KEYS.has(key)) {
    out.add(node);
  }
}

const groups = loadVocabulary();
const known = new Set(Object.values(groups).flat());
const fixtureFiles = readdirSync(join(ROOT, FIXTURE_DIR)).filter((f) => f.endsWith('.json')).sort();

let failed = false;

// 픽스처가 어휘에 없는 값을 쓰는지 파일마다 봄
for (const file of fixtureFiles) {
  const path = join(ROOT, FIXTURE_DIR, file);

  let fixture;
  try {
    fixture = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`✗ ${relative(ROOT, path)} — JSON 파싱 실패: ${err.message}`);
    failed = true;
    continue;
  }

  const values = new Set();
  collectEnumValues(fixture, null, values);

  const undefined_ = [...values].filter((v) => !known.has(v)).sort();
  const label =
    `${file}  (케이스 ${fixture.cases?.length ?? 0}개, ` +
    `불변식 ${fixture.invariants?.length ?? 0}개, 열거형 ${values.size}개)`;

  if (undefined_.length === 0) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}`);
    for (const v of undefined_) console.error(`    어휘에 없음: ${v}`);
    failed = true;
  }
}

console.log(`\n어휘 ${Object.keys(groups).length}종 / 값 ${known.size}개 (${VOCABULARY})`);

if (failed) {
  console.error('\n픽스처가 어휘에 없는 값을 씁니다. vocabulary.ts에 먼저 정의하세요.');
  process.exit(1);
}

console.log('모든 열거형 값이 어휘에 정의되어 있습니다.');
