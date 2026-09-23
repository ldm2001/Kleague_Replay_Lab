// 식별자와 해시 생성 도구 가져오기
import { createHash as digest } from "node:crypto";
// 공통 관측과 판정 자료형 가져오기
import type { ConceptKey, RuleCitation, RuleSet } from "@replay/shared-types";
// 해당 판본의 규정 자료 가져오기
import ifab202526 from "../data/ifab/2025-26.json" with { type: "json" };
// 해당 판본의 규정 자료 가져오기
import ifab202627 from "../data/ifab/2026-27.json" with { type: "json" };
// 규정 자료 구조 가져오기
import type { RuleSetFile, StoredCitation } from "./schema";

// 검사할 규정 파일 목록 구성
const FILES: readonly RuleSetFile[] = [ifab202526 as RuleSetFile, ifab202627 as RuleSetFile];
// 판본별 원문 주소 연결
const DOCUMENTS: Readonly<Record<string, string>> = Object.freeze({
    // 해당 시즌의 공식 규정 원문 주소 연결
    "2025-26": "https://downloads.theifab.com/downloads/laws-of-the-game-2025-26-single-pages?l=en",
    // 해당 시즌의 공식 규정 원문 주소 연결
    "2026-27": "https://downloads.theifab.com/downloads/laws-of-the-game-202627-single-pages?l=en",
});

// 출처 처리
const citation = (file: RuleSetFile, stored: StoredCitation): RuleCitation =>
    // 저장 규정 인용을 실행 모델로 변환
    Object.freeze({
        // 인용 규정 식별자 기록
        ruleId: `${file.versionId}-${stored.key}`,
        // 실행 규정 자료의 개정 번호 기록
        ruleRevision: stored.revision,
        // 인용 변경 감지 해시
        ruleContentSha256: digest("sha256").update(stored.quoteSnapshot, "utf8").digest("hex"),
        // 규정을 발행한 기관 기록
        authority: file.authority,
        // 규정 판본 기록
        edition: file.edition,
        // 규정의 법 조항 기록
        law: stored.law,
        // 규정의 세부 항목 기록
        section: stored.section,
        // 해당 사건과 규정의 관련성 기록
        relevance: stored.relevance,
        // 평가 당시 보존한 인용 내용 기록
        quoteSnapshot: stored.quoteSnapshot,
        // 원문 쪽 번호 기록
        sourcePage: stored.sourcePage,
        // 원문 주소 기록
        sourceUrl:
            stored.sourceUrl ??
            (file.authority === "IFAB" ? (DOCUMENTS[file.edition] ?? null) : null)
    });

// 규정 처리
const rule = (file: RuleSetFile): RuleSet => {
    // 개념별 인용 맵 초기화
    const citations = new Map<ConceptKey, readonly RuleCitation[]>();
    // 규정 파일의 인용 변환
    for (const [conceptKey, stored] of Object.entries(file.concepts)) {
        // 결론에 연결된 규정 인용 식별자와 값을 연결해 저장
        citations.set(
            conceptKey as ConceptKey,
            Object.freeze(stored.map((entry) => citation(file, entry)))
        );
    }

    // 비디오 판독 검토 범주 복사
    const varCategories = Object.freeze(
        file.varCategories.map((category) =>
            Object.freeze({
                // 고유 식별자 기록
                id: category.id,
                // 규정이 적용되는 대상 범주 기록
                appliesTo: Object.freeze([...category.appliesTo]),
                // 대회별 선택 규정 확인 필요 여부 기록
                requiresCompetitionOption: category.requiresCompetitionOption,
                // 선수 오인 여부 확인 필요 조건 기록
                requiresMistakenIdentity: category.requiresMistakenIdentity
            })
        )
    );

    // 검토 시간 예외 복사
    const timeWindowExceptions = Object.freeze({
        // 선수 신원 오인 여부 기록
        mistakenIdentity: file.timeWindowExceptions.mistakenIdentity,
        // 퇴장 관련 검토 범주 목록 기록
        sendOffCategories: Object.freeze([...file.timeWindowExceptions.sendOffCategories])
    });

    // 규정 계층 충돌 복사
    const layerConflicts = Object.freeze(
        file.layerConflicts.map((conflict) => Object.freeze(conflict))
    );

    // 규정 의미별 인용 조회 함수 및 규정 조항의 의미별 조회 키를 반영한 결과 반환
    return Object.freeze({
        // 규정 의미별 인용 조회 함수 기록
        cite: (conceptKey: ConceptKey) => [...(citations.get(conceptKey) ?? [])],
        // 허용된 비디오 판독 범주 기록
        varCategories: () => varCategories,
        // 대회에서 정한 검토 시간 예외 기록
        timeWindowExceptions: () => timeWindowExceptions,
        // 규정 계층 간 상충 사항 기록
        layerConflicts: () => layerConflicts
    });
};

// 판본 식별자로 조회할 규정 목록 구성
const REGISTRY: ReadonlyMap<string, RuleSet> = new Map(
    FILES.map((file) => [file.versionId, rule(file)]),
);

// 지원하는 규정 판본 식별자 목록 구성
export const KNOWN_RULE_VERSION_IDS: readonly string[] = Object.freeze([...REGISTRY.keys()]);

// 알 수 없는 판본은 빈 값 결과
export const ruleSet = (versionId: string): RuleSet | null => REGISTRY.get(versionId) ?? null;
