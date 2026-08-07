#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const README = 'README.md';
const DESIGN = 'docs/02-design/features/규정-데이터-룰엔진.design.md';

// 어휘의 SSOT
// README와 설계 문서는 이제 이것을 설명하는 쪽이고 정의하는 쪽이 아님
const VOCABULARY = 'packages/shared-types/src/vocabulary.ts';

const md = readFileSync(join(ROOT, README), 'utf8');
const errors = [];

// 마크다운에서 지정한 언어의 코드 블록만 골라냄
const blocks = (lang) => [...md.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))];

// 오류를 어디서 고쳐야 하는지 알려주려고 줄 번호를 구함
const lineAt = (index) => md.slice(0, index).split('\n').length;

// 절 단위로 검사하려고 해당 절 본문만 잘라냄
const sectionText = (n) => {
  const start = md.indexOf(`\n## ${n}. `);
  const next = md.indexOf(`\n## ${n + 1}. `);
  return start < 0 ? '' : md.slice(start, next < 0 ? undefined : next);
};

// 타입 검사에 쓸 ts 본문
// 주석에 든 대문자 단어가 타입으로 오인돼서 미리 지움
const tsBody = blocks('ts').map((b) => b[1]).join('\n').replace(/\/\/.*$/gm, '');

// 문서의 json 예시가 전부 파싱되는지 보고 뒤 검사가 쓸 객체를 돌려줌
function parseJsonBlocks() {
  const found = blocks('json');
  const parsed = [];
  for (const b of found) {
    try {
      parsed.push(JSON.parse(b[1]));
    } catch (e) {
      errors.push(`${README}:${lineAt(b.index)}  JSON 파싱 실패 — ${e.message}`);
    }
  }
  return { count: found.length, parsed };
}

// 본문이 가리키는 "N절"이 실재하는지 봄
function checkSectionRefs() {
  const sections = new Set([...md.matchAll(/^## (\d+)\. /gm)].map((m) => +m[1]));
  for (const m of md.matchAll(/(\d+)절/g)) {
    if (!sections.has(+m[1])) {
      errors.push(`${README}:${lineAt(m.index)}  ${m[1]}절을 참조하지만 그런 절이 없습니다`);
    }
  }
  return sections.size;
}

// 정의 없이 쓰이는 타입을 찾음
// 타입이 여러 절에 흩어져 있어서 정의가 빠져도 눈으로는 티가 안 남
function checkTypeRefs() {
  const defined = new Set([...tsBody.matchAll(/^type (\w+)/gm)].map((m) => m[1]));
  const referenced = new Set();
  for (const m of tsBody.matchAll(/:\s*([A-Z]\w+)/g)) referenced.add(m[1]);
  for (const m of tsBody.matchAll(/([A-Z]\w+)\[\]/g)) referenced.add(m[1]);
  for (const m of tsBody.matchAll(/<([A-Z]\w+)>/g)) referenced.add(m[1]);

  const GENERIC_PARAMS = new Set(['T']);
  for (const t of referenced) {
    if (!defined.has(t) && !GENERIC_PARAMS.has(t)) {
      errors.push(`${README}  타입 ${t}이(가) 정의 없이 참조됩니다`);
    }
  }
  return defined.size;
}

// 인용 객체가 RuleCitation 형태를 지키는지 봄
// 필드 목록을 정의에서 그때그때 읽어서 정의가 바뀌면 검사도 같이 바뀜
function checkCitationShape(parsed) {
  const def = tsBody.match(/type RuleCitation = \{([\s\S]*?)\n\};/);
  if (!def) {
    errors.push(`${README}  RuleCitation 정의를 찾지 못했습니다`);
    return;
  }
  const camel = [...def[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  const required = camel.map((f) => f.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()));

  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    // law와 section이 함께 있으면 인용으로 봄
    if ('law' in node && 'section' in node) {
      const missing = required.filter((f) => !(f in node));
      if (missing.length > 0) {
        errors.push(`${README}  ${path} 인용에 빠진 필드: ${missing.join(', ')}`);
      }
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  parsed.forEach((doc, i) => walk(doc, `json블록#${i + 1}`));
}

// 8절 DDL에 적힌 컬럼별 열거형을 읽어옴
// 값이 길어지면 다음 줄로 넘어가서 이어지는 줄까지 같은 컬럼으로 붙임
function ddlEnums(text) {
  const out = {};
  for (const block of text.matchAll(/```text\n([\s\S]*?)```/g)) {
    let current = null;
    for (const line of block[1].split('\n')) {
      const head = line.match(/^(\w+)\s+([A-Z][A-Z0-9_]*(?:\s*\|\s*[A-Z][A-Z0-9_]*)+)\s*$/);
      if (head) {
        current = head[1];
        out[current] = head[2].split('|').map((s) => s.trim());
        continue;
      }
      const cont = line.match(/^\s+\|\s*(.+)$/);
      if (cont && current) {
        out[current].push(...cont[1].split('|').map((s) => s.trim()).filter(Boolean));
        continue;
      }
      current = null;
    }
  }
  return out;
}

// 11절 타입의 필드 유니온을 읽어옴
function tsEnums(text) {
  const out = {};
  const body = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map((b) => b[1]).join('\n');
  for (const m of body.matchAll(/^\s*(\w+)\??:\s*((?:\s*"[A-Z][A-Z0-9_]*"\s*\|?)+)/gm)) {
    const values = [...m[2].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]);
    if (values.length > 1) out[m[1]] = values;
  }
  return out;
}

// 11절의 독립 타입 별칭을 읽어옴
// 중괄호를 배제해서 객체 타입은 대상에서 빠짐
function typeAliasEnums(text) {
  const out = {};
  const body = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map((b) => b[1]).join('\n');
  for (const m of body.matchAll(/^type (\w+) =([^;{]*);/gm)) {
    const rhs = m[2].replace(/\/\/.*$/gm, ''); // 주석에 든 대문자 단어가 값으로 오인되지 않게 지움
    const values = [...rhs.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]);
    if (values.length > 1) out[m[1]] = values;
  }
  return out;
}

// vocabulary.ts의 as const 배열을 이름별로 읽음
function vocabEnums() {
  const src = readFileSync(join(ROOT, VOCABULARY), 'utf8');
  const out = {};
  for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[([\s\S]*?)\] as const;/g)) {
    out[m[1]] = [...m[2].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]);
  }
  return out;
}

// 필드 이름과 어휘 이름이 원래 다른 자리
// 필드는 자기 객체 안에서 이름이 붙고 어휘는 전역에서 붙어서 규칙으로는 이어지지 않음
const FIELD_TO_VOCABULARY = {
  verdict: 'OFFICIAL_VERDICT',
  observedAtSpeed: 'PLAYBACK_SPEED',
  status: 'FACT_STATUS',
};

// 문서에 적힌 열거형을 어휘와 대조함
// 셋을 서로 비교하지 않고 전부 어휘 하나에 맞춤 — 그래야 문서가 조용히 뒤처지지 않음
function checkAgainstVocabulary(vocab, where, enums, label) {
  let matched = 0;

  for (const [field, values] of Object.entries(enums)) {
    // 파스칼케이스 타입 별칭이 앞에 밑줄을 달지 않게 잘라냄
    const upper = field.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase().replace(/^_/, '');
    const name = [FIELD_TO_VOCABULARY[field], upper, `VAR_${upper}`, `OBSERVED_${upper}`]
      .find((n) => n && vocab[n]);
    if (!name) {
      errors.push(`${where}  ${label} ${field}에 대응하는 어휘가 vocabulary.ts에 없습니다`);
      continue;
    }
    matched++;

    const a = new Set(vocab[name]);
    const b = new Set(values);
    const onlyVocab = [...a].filter((v) => !b.has(v));
    const onlyDoc = [...b].filter((v) => !a.has(v));
    if (onlyVocab.length || onlyDoc.length) {
      errors.push(
        `${where}  ${label} ${field} ↔ 어휘 ${name}이(가) 다릅니다` +
        (onlyDoc.length ? ` — 문서만: ${onlyDoc.join(', ')}` : '') +
        (onlyVocab.length ? ` — 어휘만: ${onlyVocab.join(', ')}` : ''),
      );
    }
  }
  return matched;
}

// 설계 문서의 어휘 스케치가 어휘와 같은지 봄
// 스케치는 구현되면 낡음 — 남겨 둘 거면 코드를 따라와야 함
function checkDesignVocabulary(vocab) {
  if (!existsSync(join(ROOT, DESIGN))) return 0;

  const design = readFileSync(join(ROOT, DESIGN), 'utf8');
  let sketched = 0;

  for (const m of design.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[([\s\S]*?)\] as const;/g)) {
    const name = m[1];
    const values = [...m[2].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((x) => x[1]);
    if (!vocab[name]) {
      errors.push(`${DESIGN}  ${name}이(가) vocabulary.ts에 없는 열거형입니다 (어휘가 설계 문서에서 자라고 있습니다)`);
      continue;
    }
    sketched++;

    const a = new Set(vocab[name]);
    const b = new Set(values);
    const onlyVocab = [...a].filter((v) => !b.has(v));
    const onlyDesign = [...b].filter((v) => !a.has(v));
    if (onlyVocab.length || onlyDesign.length) {
      errors.push(
        `${DESIGN}  ${name} ↔ 어휘가 다릅니다` +
        (onlyDesign.length ? ` — 설계만: ${onlyDesign.join(', ')}` : '') +
        (onlyVocab.length ? ` — 어휘만: ${onlyVocab.join(', ')}` : ''),
      );
    }
  }
  return sketched;
}

const { count: jsonCount, parsed } = parseJsonBlocks();
const sectionCount = checkSectionRefs();
const typeCount = checkTypeRefs();
checkCitationShape(parsed);

const vocab = vocabEnums();
const ddl = ddlEnums(sectionText(8));
const tsUnions = { ...tsEnums(sectionText(11)), ...typeAliasEnums(sectionText(11)) };
const matched8 = checkAgainstVocabulary(vocab, README, ddl, '8절');
const matched11 = checkAgainstVocabulary(vocab, README, tsUnions, '11절');
const sketched = checkDesignVocabulary(vocab);

console.log(
  `JSON 블록 ${jsonCount}개 / 절 ${sectionCount}개 / 타입 ${typeCount}개 / ` +
  `어휘 ${Object.keys(vocab).length}종 대조 — 8절 ${matched8}개, 11절 ${matched11}개, ` +
  `설계 스케치 ${sketched}개`,
);

if (errors.length > 0) {
  console.error('\n깨진 곳:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('\nREADME 내부 참조가 모두 유효합니다.');
