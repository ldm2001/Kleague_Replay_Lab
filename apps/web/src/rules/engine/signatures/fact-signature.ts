// 식별자와 해시 생성 도구 가져오기
import { createHash as digest } from "node:crypto";

// 사실 내용의 비교용 해시의 자료 구조 정의
export type FactSignature = {
    // 사실 내용의 해시
    signature: string;
    // 해시 입력 원문
    input: string;
};

// 서명에서 제외할 식별자 키
export const FORBIDDEN_SIGNATURE_KEY_PATTERN =
    /(match|referee|official|player|team|club|venue|stadium|kickoff|date|season|fixture)/i;

// 증거 포인터 키 제외
const EXCLUDED_KEYS = new Set(["shotIds"]);

// 해시 계산을 위한 자료 정규화
const normal = (value: unknown, path: string): unknown => {
    // 배열 요소 순서 보존
    if (Array.isArray(value)) {
        // 값 및 목록 순서를 반영한 결과 반환
        return value.map((entry, index) => normal(entry, `${path}[${index}]`));
    }
    // 객체 입력은 제외할 포인터 키를 빼고 필드 순서 정규화
    if (value !== null && typeof value === "object") {
        // 객체 키 정렬과 포인터 키 제거
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !EXCLUDED_KEYS.has(key))
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

        // 정규화 객체 초기화
        const output: Record<string, unknown> = {};
        // 정규화된 키와 값 구성
        for (const [key, entryValue] of entries) {
            // 테스트 실행 설정 및 조회할 항목 키의 조건에 따라 처리 분기
            if (FORBIDDEN_SIGNATURE_KEY_PATTERN.test(key)) {
                // 입력 또는 실행 조건을 만족하지 못해 오류 전달
                throw new Error(
                    `fact_signature에 식별자로 보이는 키를 넣을 수 없음: ${path ? `${path}.` : ""}${key}`,
                );
            }
            // 정규화한 자료 및 조회할 항목 키 갱신
            output[key] = normal(entryValue, path ? `${path}.${key}` : key);
        }
        // 정규화한 자료 반환
        return output;
    }
    // 값 반환
    return value;
};

// 내용 해시 계산
export const factSignature = (facts: Record<string, unknown>): FactSignature => {
    // 사실 입력을 안정적인 직렬화 자료으로 변환
    const input = JSON.stringify(normal(facts, ""));
    // 안정화된 입력 해시 생성
    return {
        // 사실 내용의 해시 기록
        signature: digest("sha256").update(input, "utf8").digest("hex"),
        // 함수에 전달된 입력 자료 기록
        input,
    };
};
