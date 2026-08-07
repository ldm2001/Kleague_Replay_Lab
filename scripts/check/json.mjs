#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 우리가 손으로 쓴 json만 검사 대상으로 둠
// 도구가 만든 파일까지 신고하면 목록이 길어져서 아무도 안 보게 됨
const SKIP_DIRS = new Set(['node_modules', 'rules', 'dist', 'build']);
const isToolFile = (name) => name.startsWith('.');

// ① 키는 snake_case로 씀
const SNAKE = /^[a-z][a-z0-9_]*$/;

// ② 값 자리에 오는 불리언과 널의 문자열 표기를 잡음
// 숫자 문자열은 여기서 걸린 값이 전부 식별자라 규칙에서 뺐음
const BOOLISH = new Set(['true', 'false', 'TRUE', 'FALSE', 'yes', 'no', 'null', 'NULL']);

// ③ 중첩 깊이 상한
// Observed<T>가 한 층을 차지해서 실측 최대가 6임
const MAX_DEPTH = 6;

// ⑤ 날짜는 ISO 8601로 씀
// 키가 date·at·day로 끝나면 날짜로 봄
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
const DATE_KEY = /(^|_)(date|at|day)$/;

const errors = [];
const report = (rule, file, path, msg) => errors.push({ rule, file, path, msg });

// 검사 대상 json 파일을 저장소 전체에서 재귀로 모음
function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || isToolFile(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectFiles(path, out);
    else if (entry.endsWith('.json')) {
      out.push({ name: relative(ROOT, path), data: JSON.parse(readFileSync(path, 'utf8')) });
    }
  }
  return out;
}

// README의 json 예시도 같은 기준으로 봄
// 문서에 실린 모양이 그대로 계약이 돼서 파일과 다를 이유가 없음
function collectReadmeBlocks() {
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
  return [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m, i) => ({
    name: `README.md json블록#${i + 1}`,
    data: JSON.parse(m[1]),
  }));
}

// ④ 한 배열의 원소가 같은 종류인지 봄
// 객체와 배열 필드만 유무를 따지고 문자열 필드는 있든 없든 넘어감
// 설명이 붙고 안 붙고는 같은 것이지만 given이 있고 없고는 다른 것임
function checkArrayHomogeneity(arr, path, file) {
  if (arr.length < 2) return;

  const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const kinds = new Set(arr.map(kind));
  if (kinds.size > 1) {
    report('④', file, path, `원소 종류가 섞여 있습니다: ${[...kinds].join(', ')}`);
    return;
  }
  if (kind(arr[0]) !== 'object') return;

  const structural = new Set();
  for (const el of arr) {
    for (const [k, v] of Object.entries(el)) {
      if (v && typeof v === 'object') structural.add(k);
    }
  }
  for (const k of structural) {
    const missing = arr.filter((el) => !(k in el)).length;
    if (missing > 0) {
      report('④', file, path, `구조 필드 \`${k}\`가 원소 ${missing}개에 없습니다 — 다른 것이 한 배열에 있습니다`);
    }
  }
}

// 문서 하나를 재귀로 훑으며 여섯 기준을 한꺼번에 걸어봄
function walk(node, path, depth, file) {
  if (depth > MAX_DEPTH) report('③', file, path, `깊이 ${depth} — ${MAX_DEPTH}를 넘습니다`);

  if (Array.isArray(node)) {
    checkArrayHomogeneity(node, path, file);
    node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, file));
    return;
  }
  if (!node || typeof node !== 'object') return;

  const keys = Object.keys(node);

  // ⑥ 최상위를 키 하나로 감싸지 않음
  // 안쪽 단일키는 원소가 하나뿐인 이름 붙은 축이라 정상으로 봄
  if (depth === 1 && keys.length === 1) {
    report('⑥', file, path, `키가 \`${keys[0]}\` 하나뿐입니다 — 한 층 올리세요`);
  }

  for (const [k, v] of Object.entries(node)) {
    if (!SNAKE.test(k)) report('①', file, `${path}.${k}`, 'snake_case가 아닙니다');
    if (typeof v === 'string') {
      if (BOOLISH.has(v)) report('②', file, `${path}.${k}`, `불리언·널을 문자열로 썼습니다: ${JSON.stringify(v)}`);
      if (DATE_KEY.test(k) && !ISO.test(v)) report('⑤', file, `${path}.${k}`, `ISO 8601이 아닙니다: ${JSON.stringify(v)}`);
    }
    walk(v, `${path}.${k}`, depth + 1, file);
  }
}

const docs = [...collectFiles(ROOT), ...collectReadmeBlocks()];
for (const d of docs) walk(d.data, '', 0, d.name);

console.log(`JSON ${docs.length}개 검사 (도구 생성 파일 제외)`);

if (errors.length > 0) {
  console.error('\n어긴 곳:');
  for (const e of errors) console.error(`  ✗ ${e.rule} ${e.file}  ${e.path || '(최상위)'}\n      ${e.msg}`);
  console.error(`\n${errors.length}건. 좋은 JSON은 열었을 때 설명이 필요 없습니다.`);
  process.exit(1);
}

console.log('\n여섯 기준을 모두 지킵니다.');
