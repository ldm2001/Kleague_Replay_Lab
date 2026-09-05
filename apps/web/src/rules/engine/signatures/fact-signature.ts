import { createHash as digest } from "node:crypto";

export type FactSignature = {
  signature: string;
  // 해시 입력 원문
  input: string;
};

// 서명에서 제외할 식별자 키
export const FORBIDDEN_SIGNATURE_KEY_PATTERN =
  /(match|referee|official|player|team|club|venue|stadium|kickoff|date|season|fixture)/i;

// 증거 포인터 키 제외
const EXCLUDED_KEYS = new Set(["shotIds"]);

const normal = (value: unknown, path: string): unknown => {
  // 배열 요소 순서 보존
  if (Array.isArray(value)) {
    return value.map((entry, index) => normal(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    // 객체 키 정렬과 포인터 키 제거
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !EXCLUDED_KEYS.has(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    // 정규화 객체 초기화
    const output: Record<string, unknown> = {};
    // 정규화된 키와 값 구성
    for (const [key, entryValue] of entries) {
      if (FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key)) {
        throw new Error(
          `fact_signature에 식별자로 보이는 키를 넣을 수 없음: ${path ? `${path}.` : ""}${key}`,
        );
      }
      output[key] = normal(entryValue, path ? `${path}.${key}` : key);
    }
    return output;
  }
  return value;
};

export const factSignature = (facts: Record<string, unknown>): FactSignature => {
  // 사실 입력을 안정적인 JSON으로 변환
  const input = JSON.stringify(normal(facts, ""));
  // 안정화된 입력 해시 생성
  return {
    signature: digest("sha256").update(input, "utf8").digest("hex"),
    input,
  };
};
