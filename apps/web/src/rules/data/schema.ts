// 공통 관측과 판정 자료형 가져오기
import type {
    Authority,
    ConceptKey,
    LayerConflict,
    Relevance,
    SendOffCategory,
    VarCategory,
    ReviewScenario
} from "@replay/shared-types";

// 규정 직렬화 자료의 인용 구조
// 저장 인용 모델
export type StoredCitation = {
    // 인용 키
    key: string;
    // 인용 판본 이력
    revision: number;
    // 법 조항 이름
    law: string;
    // 조항 세부 구간
    section: string;
    // 인용 관련성
    relevance: Relevance;
    // 원문 페이지
    sourcePage: string | null;
    // 원문 주소
    sourceUrl?: string | null;
    // 저장된 인용 문구
    quoteSnapshot: string;
};

// 저장 규정 파일 모델
export type RuleSetFile = {
    // 규정 판본 식별자
    versionId: string;
    // 규정 권위 기관
    authority: Authority;
    // 규정 에디션
    edition: string;
    // 개념별 인용 목록
    concepts: Record<ConceptKey, StoredCitation[]>;
    // 비디오 판독 범주 규칙 목록
    varCategories: {
        // 고유 식별자
        id: VarCategory;
        // 규정이 적용되는 대상 범주
        appliesTo: ReviewScenario[];
        // 대회별 선택 규정 확인 필요 여부
        requiresCompetitionOption: string | null;
        // 선수 오인 여부 확인 필요 조건
        requiresMistakenIdentity: boolean;
    }[];
    // 검토 시간 예외
    timeWindowExceptions: {
        // 선수 신원 오인 여부
        mistakenIdentity: boolean;
        // 퇴장 관련 검토 범주 목록
        sendOffCategories: SendOffCategory[];
    };
    // 규정 계층 충돌 목록
    layerConflicts: LayerConflict[];
};
