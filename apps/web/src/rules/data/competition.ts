// 식별자와 해시 생성 도구 가져오기
import { createHash as digest } from "node:crypto";
// 공통 관측과 판정 자료형 가져오기
import type { ConceptKey, RuleCitation, RuleSet, VarCategory } from "@replay/shared-types";
// 대회요강 자료형 가져오기
import type {
    CompetitionRuleBook,
    CompetitionRuleSelection,
    CompetitionScopeCategory
} from "../../shared/competition-rules";
// 해당 판본의 규정 자료 가져오기
import kleague12025 from "./kleague/2025/kleague1.json" with { type: "json" };
// 해당 판본의 규정 자료 가져오기
import kleague22025 from "./kleague/2025/kleague2.json" with { type: "json" };
// 해당 판본의 규정 자료 가져오기
import kleague12026 from "./kleague/2026/kleague1.json" with { type: "json" };
// 해당 판본의 규정 자료 가져오기
import kleague22026 from "./kleague/2026/kleague2.json" with { type: "json" };
// 규정 판본 조회 기능 가져오기
import { ruleSet } from "./catalog";
// 대회요강 파일 구조 가져오기
import type { CompetitionRuleBookFile } from "./competition-schema";
// 규정 자료 구조 가져오기
import type { StoredCitation } from "./schema";

// 검사할 규정 파일 목록 구성
const FILES: readonly CompetitionRuleBookFile[] = [
    kleague12025 as CompetitionRuleBookFile,
    kleague22025 as CompetitionRuleBookFile,
    kleague12026 as CompetitionRuleBookFile,
    kleague22026 as CompetitionRuleBookFile,
];

// 출처 처리
const citation = (file: CompetitionRuleBookFile, stored: StoredCitation): RuleCitation =>
    Object.freeze({
        // 인용 규정 식별자 기록
        ruleId: `${file.versionId}-${stored.key}`,
        // 실행 규정 자료의 개정 번호 기록
        ruleRevision: stored.revision,
        // 규정 내용의 해시 기록
        ruleContentSha256: digest("sha256").update(stored.quoteSnapshot, "utf8").digest("hex"),
        // 규정을 발행한 기관 기록
        authority: "KLEAGUE",
        // 규정 판본 기록
        edition: file.season,
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
        sourceUrl: stored.sourceUrl ?? file.source.url,
    });

// 규정 처리
const ruleBook = (file: CompetitionRuleBookFile): CompetitionRuleBook => {
    // 결론에 연결된 규정 인용 보관 공간 생성
    const citations = new Map<ConceptKey, readonly RuleCitation[]>();
    // 항목 이름과 값의 묶음 및 조항을 조회하기 위한 의미별 키의 각 항목을 순서대로 검사
    for (const [concept, stored] of Object.entries(file.concepts)) {
        // 결론에 연결된 규정 인용 식별자와 값을 연결해 저장
        citations.set(
            concept as ConceptKey,
            Object.freeze(stored.map((entry) => citation(file, entry)))
        );
    }
    // 버전 식별자 및 경기가 속한 대회를 반영한 결과 반환
    return Object.freeze({
        // 버전 식별자 기록
        versionId: file.versionId,
        // 경기가 속한 대회 기록
        competition: file.competition,
        // 대회 시즌 기록
        season: file.season,
        // 화면 또는 규정 표시 제목 기록
        title: file.title,
        // 원본 정보 기록
        source: Object.freeze({ ...file.source }),
        // 대회가 허용한 검토 범주 기록
        scopeCategories: Object.freeze(
            file.scopeCategories.map((category) => Object.freeze({ ...category }))
        ),
        // 최종 판정 공개 안내 조건 기록
        publicAnnouncement: file.publicAnnouncement,
        // 규정 의미별 인용 조회 함수 기록
        cite: (concept: ConceptKey) => [...(citations.get(concept) ?? [])]
    });
};

// 판본 식별자로 조회할 규정 목록 구성
const REGISTRY: ReadonlyMap<string, CompetitionRuleBook> = new Map(
    FILES.map((file) => [`${file.competition}:${file.season}`, ruleBook(file)]),
);

// 규정 처리
export const competitionRules = (competition: string, season: string): CompetitionRuleBook | null =>
    REGISTRY.get(`${competition}:${season}`) ?? null;

// 대회요강의 네 범주를 실행 어휘로 변환 세부 적용 대상과 시간 창은 국제축구평의회가 관리
const SCOPE_CATEGORIES: Readonly<Record<CompetitionScopeCategory["topic"], VarCategory>> =
    Object.freeze({
        // 해당 판독 범주를 대회요강의 적용 범위와 연결
        GOAL_RELATED: "GOAL_NO_GOAL",
        // 해당 판독 범주를 대회요강의 적용 범위와 연결
        PENALTY_RELATED: "PENALTY_NO_PENALTY",
        // 해당 판독 범주를 대회요강의 적용 범위와 연결
        SENDING_OFF_RELATED: "RED_CARD",
        // 해당 판독 범주를 대회요강의 적용 범위와 연결
        DISCIPLINARY_ERROR: "MISTAKEN_IDENTITY"
    });

// 조합 가능 여부만 검사하며 경기별 판본 채택과 효력은 별도 검증 필요
export const competitionSet = ({
    competition,
    season,
    ifabVersionId
}: CompetitionRuleSelection): RuleSet | null => {
    // 기준 규정 묶음 확인
    const base = ruleSet(ifabVersionId);
    // 대회요강 묶음 확인
    const book = competitionRules(competition, season);
    // 기준 규정 묶음 및 대회요강 묶음의 조건에 따라 처리 분기
    if (!base || !book) return null;
    // 현재 평가 범위 보관 공간 생성
    const scope = new Set(book.scopeCategories.map((category) => SCOPE_CATEGORIES[category.topic]));
    // 검토 대상 범주 목록 선별
    const categories = Object.freeze(
        base.varCategories().filter((category) => scope.has(category.id))
    );
    // 규정 의미별 인용 조회 함수 및 규정 조항의 의미별 조회 키를 반영한 결과 반환
    return Object.freeze({
        // 규정 의미별 인용 조회 함수 기록
        cite: (concept: ConceptKey) => [...base.cite(concept), ...book.cite(concept)],
        // 허용된 비디오 판독 범주 기록
        varCategories: () => categories,
        // 대회에서 정한 검토 시간 예외 기록
        timeWindowExceptions: () => base.timeWindowExceptions(),
        // 규정 계층 간 상충 사항 기록
        layerConflicts: () => base.layerConflicts()
    });
};
