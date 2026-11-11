import { describe, expect, it } from "vitest";
import { KNOWN_RULE_VERSION_IDS, competitionRules, ruleSet } from "@replay/rule-data";
import { CONCEPT_KEYS, VAR_SCOPE_NOT_ASSESSED, type RuleCitation } from "@replay/shared-types";
import { clause, delegationNote, question, unassessed } from "./model";

// 경기규칙과 대회요강 자료에 실린 모든 인용 수집
const shipped = (): RuleCitation[] => {
    // 수집 결과 보관 공간 생성
    const found: RuleCitation[] = [];
    // 경기규칙 판본별 인용 수집
    for (const id of KNOWN_RULE_VERSION_IDS) {
        // 판본의 개념 키별 인용 수집
        for (const key of CONCEPT_KEYS) found.push(...ruleSet(id)!.cite(key));
    }
    // 대회요강 대회별 인용 수집
    for (const competition of ["K리그1", "K리그2"]) {
        // 대회요강 시즌별 인용 수집
        for (const season of ["2025", "2026"]) {
            // 대회요강 묶음 읽음
            const book = competitionRules(competition, season)!;
            // 묶음의 개념 키별 인용 수집
            for (const key of CONCEPT_KEYS) found.push(...book.cite(key));
        }
    }
    // 수집한 인용 목록 반환
    return found;
};

// 기관별 허용 표기 형태 연결
const SHAPES: Readonly<Record<string, readonly RegExp[]>> = {
    // 경기규칙은 번호형 규칙과 이름형 영역의 네 형태만 허용
    IFAB: [
        // 번호형 규칙과 번호형 세부
        /^IFAB Law \d+\.\d+$/,
        // 번호형 규칙과 이름형 세부
        /^IFAB Law \d+ · [A-Za-z][A-Za-z ]*$/,
        // 이름형 영역과 숫자로 시작하는 세부
        /^IFAB (?!Law )[A-Za-z]+ \d+(\.[0-9a-z]+)?$/,
        // 이름형 영역과 이름형 세부
        /^IFAB (?!Law )[A-Za-z]+ · [A-Za-z][A-Za-z ]*$/
    ],
    // 대회요강은 조와 항 번호 표기만 허용
    KLEAGUE: [/^대회요강 제\d+조 \d+항$/]
};

// 사용자에게 입력이나 확인을 요구하는 표현 정의
const REQUEST = /해 주세요|하세요|하십시오|바랍니다|입력|선택해|설정해|확인해/;

describe("clause", () => {
    it.each([
        ["KLEAGUE", "25", "1", "대회요강 제25조 1항"],
        ["IFAB", "17", "1", "IFAB Law 17.1"],
        ["IFAB", "12", "Introduction", "IFAB Law 12 · Introduction"],
        ["IFAB", "VAR", "1.10", "IFAB VAR 1.10"],
        ["IFAB", "VAR", "2.c", "IFAB VAR 2.c"],
        ["IFAB", "Glossary", "Holding offence", "IFAB Glossary · Holding offence"]
    ] as const)("formats %s %s %s as %s", (authority, law, section, label) => {
        // 기관과 조항 번호의 사람이 읽는 표기 일치 확인
        expect(clause({ authority, law, section })).toBe(label);
    });

    it("shows an unrecognized clause shape exactly as recorded", () => {
        // 번호가 아닌 대회요강 항의 기록 그대로 표기 확인
        expect(clause({ authority: "KLEAGUE", law: "25", section: "부칙" })).toBe(
            "KLEAGUE 25 부칙"
        );
        // 표기 규칙이 없는 기관의 기록 그대로 표기 확인
        expect(clause({ authority: "KFA", law: "3", section: "2" })).toBe("KFA 3 2");
    });

    it.each([
        ["12", "1.2", "IFAB 12 1.2"],
        ["12", "", "IFAB 12 "],
        ["12", "Introduction 2", "IFAB 12 Introduction 2"],
        ["12", " Introduction", "IFAB 12  Introduction"],
        ["12", "Introduction.", "IFAB 12 Introduction."],
        ["12 ", "1", "IFAB 12  1"],
        ["12a", "1", "IFAB 12a 1"],
        ["1VAR", "Introduction", "IFAB 1VAR Introduction"],
        ["VAR2", "Introduction", "IFAB VAR2 Introduction"],
        ["Law", "Introduction", "IFAB Law Introduction"],
        ["", "Introduction", "IFAB  Introduction"],
        ["VAR", "", "IFAB VAR "],
        ["VAR", "Introduction 2", "IFAB VAR Introduction 2"],
        ["VAR", "1.1.1", "IFAB VAR 1.1.1"]
    ] as const)(
        "shows the IFAB clause %s %s outside the four shapes as recorded",
        (law, section, label) => {
            // 네 형태 밖 경기규칙 조항의 기록 그대로 표기 확인
            expect(clause({ authority: "IFAB", law, section })).toBe(label);
            // 기록 그대로 표기가 허용 형태에 맞지 않아 새 출고 형태의 표기 규칙 선행 강제 확인
            expect(SHAPES.IFAB!.some((shape) => shape.test(label))).toBe(false);
        }
    );

    it("recognizes the shape of every shipped citation", () => {
        // 수집한 인용 목록 준비
        const citations = shipped();
        // 두 기관의 자료가 모두 수집됨 확인
        expect(new Set(citations.map((item) => item.authority))).toEqual(
            new Set(["IFAB", "KLEAGUE"])
        );
        // 인용별 순회
        for (const item of citations) {
            // 기관의 표기 형태 정의 존재 확인
            expect(SHAPES[item.authority], item.authority).toBeDefined();
            // 인용의 조항 표기 준비
            const label = clause(item);
            // 정해진 형태 중 하나에 맞음 확인하며 새 조항 형태는 표기 규칙을 먼저 정하도록 강제
            expect(
                SHAPES[item.authority]!.some((shape) => shape.test(label)),
                `${item.ruleId} ${label}`
            ).toBe(true);
            // 표기가 조 번호를 포함함 확인
            expect(label, item.ruleId).toContain(item.law);
            // 표기가 세부 번호를 포함함 확인
            expect(label, item.ruleId).toContain(item.section);
        }
    });

    it("gives different clauses different labels", () => {
        // 표기별 조항 키 보관 공간 생성
        const owners = new Map<string, Set<string>>();
        // 인용별 순회
        for (const item of shipped()) {
            // 표기에 연결된 조항 키 묶음 읽음
            const keys = owners.get(clause(item)) ?? new Set<string>();
            // 기관과 조 번호와 세부 번호로 조항 키 기록
            keys.add(`${item.authority}|${item.law}|${item.section}`);
            // 표기와 조항 키 묶음 연결
            owners.set(clause(item), keys);
        }
        // 표기 하나가 조항 둘 이상을 가리키지 않음 확인
        for (const [label, keys] of owners) expect(keys.size, label).toBe(1);
    });
});

describe("unassessed", () => {
    it("explains exactly the questions the engine can leave unassessed", () => {
        // 사전 키와 엔진이 보고하는 질문 코드의 일치 확인
        expect(Object.keys(unassessed).sort()).toEqual([...VAR_SCOPE_NOT_ASSESSED].sort());
    });

    it("gives each question its own name and reason", () => {
        // 질문별 설명 목록 준비
        const items = Object.values(unassessed);
        // 설명별 순회
        for (const item of items) {
            // 이름이 비어 있지 않음 확인
            expect(item.name.trim()).not.toBe("");
            // 사유가 비어 있지 않음 확인
            expect(item.reason.trim()).not.toBe("");
        }
        // 질문 이름의 중복 없음 확인
        expect(new Set(items.map((item) => item.name)).size).toBe(items.length);
        // 질문 사유의 중복 없음 확인
        expect(new Set(items.map((item) => item.reason)).size).toBe(items.length);
    });

    it("states that the edition is never inferred from the upload date", () => {
        // 판본 질문의 사유에 업로드 날짜로 추정하지 않는 원칙의 명시 확인
        expect(unassessed.IFAB_EDITION_ADOPTION.reason).toMatch(/업로드 날짜로 추정하지/);
    });
});

describe("question", () => {
    it("returns the dictionary entry for every known question", () => {
        // 질문 코드별 순회
        for (const code of VAR_SCOPE_NOT_ASSESSED) {
            // 사전 항목과 같은 설명 반환 확인
            expect(question(code)).toBe(unassessed[code]);
        }
    });

    it.each(["FUTURE_QUESTION", "constructor", "toString", "__proto__"])(
        "falls back to the general entry for %s",
        (code) => {
            // 사전 밖 식별자와 상속 속성 이름의 일반 이름과 사유 반환 확인
            expect(question(code)).toEqual({
                name: "그 밖의 질문",
                reason: "이 분석에서 평가하지 않은 질문입니다"
            });
        }
    );

    it("keeps the general entry apart from every known question", () => {
        // 일반 항목 준비
        const general = question("FUTURE_QUESTION");
        // 질문별 설명 순회
        for (const item of Object.values(unassessed)) {
            // 일반 이름과 질문 이름의 구별 확인
            expect(general.name).not.toBe(item.name);
            // 일반 사유와 질문 사유의 구별 확인
            expect(general.reason).not.toBe(item.reason);
        }
    });
});

describe("delegationNote", () => {
    it("states that the delegating clause names no edition", () => {
        // 위임 조항 안내 문구에 판본 미지정 사실의 명시 확인
        expect(delegationNote).toMatch(/판본은 지정하지 않습니다/);
    });
});

describe("copy", () => {
    it("never asks the user to supply or confirm anything", () => {
        // 일반 항목 준비
        const general = question("FUTURE_QUESTION");
        // 질문별 이름과 사유 및 일반 항목과 위임 안내 문구 수집
        const texts = [
            ...Object.values(unassessed).flatMap((item) => [item.name, item.reason]),
            general.name,
            general.reason,
            delegationNote
        ];
        // 문구별 순회
        for (const text of texts) {
            // 사용자에게 입력이나 확인을 요구하는 표현 부재 확인
            expect(text).not.toMatch(REQUEST);
        }
    });
});
