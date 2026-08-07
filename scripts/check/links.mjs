#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_DIR = 'packages/rule-engine/fixtures';
const CASE_DIR = 'datasets/labeled-cases';

// 디렉터리 안의 json 파일명을 정렬해 돌려줌
const jsonFiles = (dir) =>
  readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort();

const read = (dir, file) => JSON.parse(readFileSync(join(ROOT, dir, file), 'utf8'));

// 참조 대상이 될 픽스처 id를 파일명#id 형태로 모음
// 케이스와 불변식은 배열이 갈라져 있어도 id 이름공간은 스위트 하나로 같이 씀
function loadFixtures() {
  const ids = new Set();
  const list = [];
  let caseCount = 0;
  let invariantCount = 0;

  for (const file of jsonFiles(FIXTURE_DIR)) {
    const fixture = read(FIXTURE_DIR, file);
    list.push({ file, fixture });
    for (const c of fixture.cases ?? []) ids.add(`${file}#${c.id}`);
    for (const i of fixture.invariants ?? []) ids.add(`${file}#${i.id}`);
    caseCount += fixture.cases?.length ?? 0;
    invariantCount += fixture.invariants?.length ?? 0;
  }
  return { list, ids, caseCount, invariantCount };
}

// 참조 대상이 될 라벨 사례의 case_id를 모음
function loadCases() {
  const ids = new Set();
  const list = [];
  for (const file of jsonFiles(CASE_DIR)) {
    const record = read(CASE_DIR, file);
    list.push({ file, record });
    ids.add(record.case_id);
  }
  return { list, ids };
}

// 픽스처가 가리키는 라벨 사례 파일이 실재하는지 봄
function checkFixtureToCase(fixtures, errors) {
  for (const { file, fixture } of fixtures) {
    for (const c of fixture.cases ?? []) {
      if (!c.derived_from) continue;
      if (!existsSync(join(ROOT, c.derived_from))) {
        errors.push(`${file}#${c.id}  derived_from 경로가 없습니다: ${c.derived_from}`);
      }
    }
  }
}

// 라벨 사례가 가리키는 픽스처와 대조 사례가 실재하는지 봄
function checkCaseToFixture(cases, fixtureIds, caseIds, errors) {
  for (const { file, record } of cases) {
    for (const ref of record.derived_fixtures ?? []) {
      if (!fixtureIds.has(ref)) {
        errors.push(`${file}  derived_fixtures 대상이 없습니다: ${ref}`);
      }
    }
    const contrast = record.cross_reference?.contrast_with;
    if (contrast && !caseIds.has(contrast)) {
      errors.push(`${file}  cross_reference.contrast_with 대상이 없습니다: ${contrast}`);
    }
  }
}

const errors = [];
const fixtures = loadFixtures();
const cases = loadCases();

checkFixtureToCase(fixtures.list, errors);
checkCaseToFixture(cases.list, fixtures.ids, cases.ids, errors);

console.log(
  `픽스처 ${fixtures.list.length}개 / 케이스 ${fixtures.caseCount}개 / ` +
  `불변식 ${fixtures.invariantCount}개`,
);
console.log(`라벨 사례 ${cases.list.length}건`);

if (errors.length > 0) {
  console.error('\n끊어진 참조:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('\n모든 상호 참조가 유효합니다.');
