import { createHash } from "node:crypto";

export type FactSignature = {
  signature: string;
  /** 해시의 원문. 서명에 무엇이 들어갔는지 검사할 수 있게 함께 반환한다. */
  input: string;
};

/**
 * 서명에 들어가서는 안 되는 키.
 * 이 목록은 축소하지 않는다 — 서명은 사건이 아니라 사실 조합을 가리켜야 한다.
 */
export const FORBIDDEN_SIGNATURE_KEY_PATTERN =
  /(match|referee|official|player|team|club|venue|stadium|kickoff|date|season|fixture)/i;

/** 증거 포인터일 뿐 사실값이 아니므로 서명에서 제외한다. */
const EXCLUDED_KEYS = new Set(["shotIds"]);

const normalize = (value: unknown, path: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalize(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !EXCLUDED_KEYS.has(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      if (FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key)) {
        throw new Error(
          `fact_signature에 식별자로 보이는 키를 넣을 수 없음: ${path ? `${path}.` : ""}${key}`,
        );
      }
      normalized[key] = normalize(entryValue, path ? `${path}.${key}` : key);
    }
    return normalized;
  }
  return value;
};

export const buildFactSignature = (facts: Record<string, unknown>): FactSignature => {
  const input = JSON.stringify(normalize(facts, ""));
  return {
    signature: createHash("sha256").update(input, "utf8").digest("hex"),
    input,
  };
};
