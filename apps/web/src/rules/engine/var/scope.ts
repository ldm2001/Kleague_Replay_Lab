// 공통 관측과 판정 자료형 가져오기
import type {
    CompetitionRuleBook,
    ScopeEvidence,
    ScopeSourceContext,
    VarScopeEvaluation
} from "@replay/shared-types";
// 공통 관측과 판정 자료형 가져오기
import { broadcastCueData, VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";

// 비디오 판독 범위 평가 입력의 자료 구조 정의
export type VarScopeInput = Readonly<{
    // 방송 화면에서 관측한 단서
    broadcastCue: unknown;
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 관련 영상 근거 목록
    evidence: readonly ScopeEvidence[];
    // 원본 정보
    source: ScopeSourceContext | null;
}>;

// 비디오 판독 적용 범위 평가
export const scopeVerdict = (
    input: VarScopeInput,
    book: CompetitionRuleBook | null
): VarScopeEvaluation | null => {
    // 검증할 원본과 방송 단서를 평가 입력에서 분리
    const { source, broadcastCue: cue } = input;
    // 원본 정보 및 대회요강 묶음의 조건에 따라 처리 분기
    if (
        !source ||
        !book ||
        source.verification !== "REGISTERED_SOURCE_HASH" ||
        !/^[0-9a-f]{64}$/.test(source.sourceSha256) ||
        !source.matchKey ||
        source.sourceUrls.length === 0 ||
        source.competition !== book.competition ||
        source.season !== book.season ||
        !broadcastCueData(cue, input.startMs, input.endMs)
    ) {
        // 확인 가능한 결과가 없어 빈 값 반환
        return null;
    }
    // 방송의 득점 관련 표시는 득점 인정이나 취소 사유를 뜻하지 않음
    const category = book.scopeCategories.find((item) => item.topic === "GOAL_RELATED");
    // 현재 검토 범주의 조건에 따라 처리 분기
    if (!category) return null;
    // 후보를 포함하는 클립 목록 선별
    const clips = input.evidence.filter(
        (item) =>
            item.kind === "CLIP" &&
            item.evidenceId.length > 0 &&
            Number.isSafeInteger(item.startMs) &&
            Number.isSafeInteger(item.endMs) &&
            item.startMs >= 0 &&
            item.startMs <= cue.startMs &&
            item.endMs >= cue.endMs
    );
    // 후보를 포함하는 클립 목록의 조건에 따라 처리 분기
    if (clips.length === 0) return null;
    // 결론에 연결된 규정 인용 선별
    const citations = book
        .cite("VAR_REVIEWABLE_CATEGORIES")
        .filter(
            (item) =>
                item.authority === "KLEAGUE" &&
                item.edition === source.season &&
                item.ruleId.startsWith(`${book.versionId}-`) &&
                item.law === category.law &&
                (item.section === category.section || item.section === "1")
        );
    // 결론에 연결된 규정 인용의 조건에 따라 처리 분기
    if (citations.length === 0) return null;
    // 보관 시점을 포함한 규정 판본 이름 계산
    const editionLabel = book.source.snapshotDate
        ? `${book.title} (${book.source.snapshotDate} 보관본)`
        : book.title;
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 결과 종류 기록
        kind: "COMPETITION_VAR_SCOPE",
        // 현재 처리 상태 기록
        status: "COMPLETED",
        // 범위 평가의 주제 기록
        topic: "GOAL_RELATED",
        // 범위에 포함된 항목 기록
        included: true,
        // 이번 규정 평가가 답하는 질문 기록
        question: "이 득점 관련 장면은 대회요강의 VAR 적용 범주에 해당하는가",
        // 결과를 설명하는 내용 기록
        explanation: `중계의 GOAL 표시가 관찰된 득점 관련 장면으로 제공된 ${editionLabel} 제25조 1항의 득점 상황 범주에 해당합니다`,
        // 경기가 속한 대회 기록
        competition: source.competition,
        // 대회 시즌 기록
        season: source.season,
        // 실제로 적용한 규정 판본 식별자 기록
        ruleVersionId: book.versionId,
        // 결론에 연결된 규정 인용 기록
        citations,
        // 연결된 증거 식별자 목록 기록
        evidenceIds: [...new Set(clips.map((item) => item.evidenceId))],
        // 이번 평가에서 판단하지 않은 질문 기록
        notAssessed: VAR_SCOPE_NOT_ASSESSED,
        // 자료가 생성된 방법과 출처 기록
        provenance: {
            // 직접 측정과 추정 및 연결의 출처 구분 기록
            origin: "VIDEO_CUE_AND_COMPETITION_RULES",
            // 판정 계산기의 버전 기록
            evaluatorVersion: "competition-var-scope-v1",
            // 원본 영상의 내용 해시 기록
            sourceSha256: source.sourceSha256,
            // 원본과 경기를 연결하는 키 기록
            matchKey: source.matchKey,
            // 원문 주소 목록 기록
            sourceUrls: [...source.sourceUrls],
            // 단서를 생성한 방법 기록
            cueMethod: cue.method,
            // 단서 시작 시각 기록
            cueStartMs: cue.startMs,
            // 단서 종료 시각 기록
            cueEndMs: cue.endMs,
            // 규정 원문 해시 기록
            ruleDocumentSha256: book.source.documentSha256
        }
    };
};
