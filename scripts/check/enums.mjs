#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 값이 정의됐는지 판단하는 근거 문서
// 어휘의 소유자가 아직 코드가 아니라 문서라 이 둘을 기준으로 씀
const DOC_FILES = [
  'README.md',
  'docs/01-plan/features/규정-데이터-룰엔진.plan.md',
];

const FIXTURE_DIR = 'packages/rule-engine/fixtures';

// 검사에서 빼는 키
// 픽스처 파일을 설명하는 값이라 도메인 어휘가 아님
const META_KEYS = new Set(['suite', 'assertion_mode', 'fixture_schema_version']);

// 세 글자 이상 대문자만 열거형 값으로 봄
const ENUM_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

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

const docs = DOC_FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const fixtureFiles = readdirSync(join(ROOT, FIXTURE_DIR)).filter((f) => f.endsWith('.json')).sort();

let failed = false;

// 픽스처가 문서에 없는 값을 쓰는지 파일마다 봄
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

  const undefined_ = [...values].filter((v) => !docs.includes(v)).sort();
  const label =
    `${file}  (케이스 ${fixture.cases?.length ?? 0}개, ` +
    `불변식 ${fixture.invariants?.length ?? 0}개, 열거형 ${values.size}개)`;

  if (undefined_.length === 0) {
    console.log(`✓ ${label}`);
  } else {
    console.error(`✗ ${label}`);
    for (const v of undefined_) console.error(`    문서에 정의되지 않음: ${v}`);
    failed = true;
  }
}

if (failed) {
  console.error('\n픽스처가 문서에 없는 값을 씁니다. 스키마를 먼저 정의하세요.');
  process.exit(1);
}

console.log('\n모든 열거형 값이 문서에 정의되어 있습니다.');
