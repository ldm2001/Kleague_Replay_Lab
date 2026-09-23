// 공통 상태 값 목록 가져오기
import type { Authority, FactBlocker, FactStatus, Relevance } from "./vocabulary";

// 인용 단위 출처 보존
// 규정 인용 모델
export type RuleCitation = {
    // 인용 규정 식별자
    ruleId: string;
    // 실행 규정 자료의 개정 번호
    ruleRevision: number;
    // 규정 내용의 해시
    ruleContentSha256: string;
    // 규정을 발행한 기관
    authority: Authority;
    // 규정 판본
    edition: string;
    // 법 조항 구분
    law: string;
    // 규정의 세부 항목
    section: string;
    // 해당 사건과 규정의 관련성
    relevance: Relevance;
    // 평가 당시 보존한 인용 내용
    quoteSnapshot: string;
    // 원문 쪽 번호
    sourcePage: string | null;
    // 원문 주소
    sourceUrl?: string | null;
};

// 조항 탐색을 막는 사실 요구
// 사실 요구 모델
export type FactRequirement = {
    // 검사할 개별 사실
    fact: string;
    // 현재 처리 상태
    status: FactStatus;
    // 관측 불확정과 관측 차단 구분
    blockedBy: FactBlocker | null;
    // 범위를 제한하는 조건
    narrowsTo: RuleCitation | null;
};

// 권위 계층 모델
export type AuthorityAccount = {
    // 규정을 발행한 기관
    authority: Authority;
    // 규정 판본
    edition: string;
    // 결론에 연결된 규정 인용
    citations: RuleCitation[];
    // 아직 확인이 필요한 사실 조건
    requires: FactRequirement[];
};

// 규정 계층 충돌 기록
// 계층 충돌 모델
export type LayerConflict = {
    // 범위 평가의 주제
    topic: string;
    // 판독 결과 목록
    readings: { authority: string; text: string }[];
};
