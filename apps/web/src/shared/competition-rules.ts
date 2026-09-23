// 규정 인용 자료형 가져오기
import type { RuleCitation } from "./citation";
// 실행 규정 묶음 가져오기
import type { ConceptKey } from "./rule-set";

// 대회별 검토 허용 범주의 자료 구조 정의
export type CompetitionScopeCategory = Readonly<{
    // 범위 평가의 주제
    topic: "GOAL_RELATED" | "PENALTY_RELATED" | "SENDING_OFF_RELATED" | "DISCIPLINARY_ERROR";
    // 원본 표시 이름
    sourceLabel: string;
    // 규정의 법 조항
    law: "25";
    // 규정의 세부 항목
    section: "1.1" | "1.2" | "1.3" | "1.4";
}>;

// 대회요강의 출처와 명시된 운영 범위 국제축구평의회 판본 채택을 입증 범위 제외
export type CompetitionRuleBook = Readonly<{
    // 버전 식별자
    versionId: string;
    // 경기가 속한 대회
    competition: "K리그1" | "K리그2";
    // 대회 시즌
    season: string;
    // 화면 또는 규정 표시 제목
    title: string;
    // 원본 정보
    source: Readonly<{
        // 접근 주소
        url: string;
        // 규정 원문 파일의 해시
        documentSha256: string;
        // 해당 원문을 확보한 기준 날짜
        snapshotDate: string | null;
        // 로컬 파일 경로
        localPath: string;
    }>;
    // 대회가 허용한 검토 범주
    scopeCategories: readonly CompetitionScopeCategory[];
    // 최종 판정 공개 안내 조건
    publicAnnouncement: "OFR_ONLY" | "NOT_STATED";
    cite(conceptKey: ConceptKey): RuleCitation[];
}>;

// 호출자가 별도로 확인한 구성요소를 명시 시즌에서 국제축구평의회 판본을 추정 제외
export type CompetitionRuleSelection = Readonly<{
    // 경기가 속한 대회
    competition: string;
    // 대회 시즌
    season: string;
    // 국제 경기 규칙 판본 식별자
    ifabVersionId: string;
}>;
