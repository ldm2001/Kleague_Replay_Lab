// 규정 인용 자료형 가져오기
import type { RuleCitation } from "./citation";
// 대회요강 자료형 가져오기
import type { CompetitionScopeCategory } from "./competition-rules";

// 방송 화면에서 관측한 단서의 자료 구조 정의
export type BroadcastCue = Readonly<{
    // 결과 종류
    kind: "GOAL_GRAPHIC";
    // 관측 또는 검사 방법
    method: "broadcast-goal-glyphs-v1";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 근거가 되는 원본 시각 목록
    evidenceTimestampsMs: readonly number[];
}>;

// 범위 평가에 연결한 원본 문맥의 자료 구조 정의
export type ScopeSourceContext = Readonly<{
    // 원본 영상의 내용 해시
    sourceSha256: string;
    // 원본과 경기를 연결하는 키
    matchKey: string;
    // 경기가 속한 대회
    competition: "K리그1" | "K리그2";
    // 대회 시즌
    season: string;
    // 경기 정보의 검증 상태
    verification: "REGISTERED_SOURCE_HASH";
    // 원문 주소 목록
    sourceUrls: readonly string[];
}>;

// 범위 평가에 사용할 근거의 자료 구조 정의
export type ScopeEvidence = Readonly<{
    // 증거 식별자
    evidenceId: string;
    // 결과 종류
    kind: "FRAME" | "CLIP";
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
}>;

// 범위 평가로 판단하지 않는 질문 목록 정의
export const VAR_SCOPE_NOT_ASSESSED = Object.freeze([
    "FOUL_DECISION", "REFEREE_DECISION_CORRECTNESS", "VAR_CHECK_PERFORMED",
    "VAR_INTERVENTION_NECESSITY", "REVIEW_TIME_WINDOW", "IFAB_EDITION_ADOPTION",
] as const);

// 비디오 판독 범위 평가 결과의 자료 구조 정의
export type VarScopeEvaluation = Readonly<{
    // 결과 종류
    kind: "COMPETITION_VAR_SCOPE";
    // 현재 처리 상태
    status: "COMPLETED";
    // 범위 평가의 주제
    topic: CompetitionScopeCategory["topic"];
    // 범위에 포함된 항목
    included: boolean;
    // 이번 규정 평가가 답하는 질문
    question: string;
    // 결과를 설명하는 내용
    explanation: string;
    // 경기가 속한 대회
    competition: "K리그1" | "K리그2";
    // 대회 시즌
    season: string;
    // 실제로 적용한 규정 판본 식별자
    ruleVersionId: string;
    // 결론에 연결된 규정 인용
    citations: readonly RuleCitation[];
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 이번 평가에서 판단하지 않은 질문
    notAssessed: typeof VAR_SCOPE_NOT_ASSESSED;
    // 자료가 생성된 방법과 출처
    provenance: Readonly<{
        // 직접 측정과 추정 및 연결의 출처 구분
        origin: "VIDEO_CUE_AND_COMPETITION_RULES";
        // 판정 계산기의 버전
        evaluatorVersion: "competition-var-scope-v1";
        // 원본 영상의 내용 해시
        sourceSha256: string;
        // 원본과 경기를 연결하는 키
        matchKey: string;
        // 원문 주소 목록
        sourceUrls: readonly string[];
        // 단서를 생성한 방법
        cueMethod: BroadcastCue["method"];
        // 단서 시작 시각
        cueStartMs: number;
        // 단서 종료 시각
        cueEndMs: number;
        // 규정 원문 해시
        ruleDocumentSha256: string;
    }>;
}>;

// 방송 단서의 종류와 후보 내 시각 확인
export const broadcastCueData = (
    value: unknown,
    startMs: number,
    endMs: number
): value is BroadcastCue => {
    // 방송 단서가 일반 객체 형태인지 확인
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // 현재 검토할 단서 계산
    const cue = value as Record<string, unknown>;

    // 시각 범위 확인
    const time = (item: unknown): item is number =>
        typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
    // 후보 구간과 방송 단서 종류 및 근거 시각 배열의 형식 확인
    if (
        !time(startMs) ||
        !time(endMs) ||
        endMs <= startMs ||
        cue.kind !== "GOAL_GRAPHIC" ||
        cue.method !== "broadcast-goal-glyphs-v1" ||
        !time(cue.startMs) ||
        !time(cue.endMs) ||
        cue.startMs < startMs ||
        cue.endMs > endMs ||
        cue.endMs <= cue.startMs ||
        !Array.isArray(cue.evidenceTimestampsMs) ||
        cue.evidenceTimestampsMs.length < 2 ||
        cue.evidenceTimestampsMs.length > 256
    ) {
        // 필수 조건 불충족 결과 반환
        return false;
    }
    // 단서의 시작 시각과 종료 시각 참조
    const first = cue.startMs,
        // 현재 단서의 마지막 시각 확인
        last = cue.endMs;
    // 근거 시각 목록 참조
    const times = cue.evidenceTimestampsMs;
    // 근거 시각이 단서 구간 안에서 중복 없이 증가하는지 반환
    return (
        times.every(
            (item, index) =>
                time(item) &&
                item >= first &&
                item <= last &&
                (index === 0 || item > times[index - 1])
        ) &&
        times[0] === first &&
        times[times.length - 1] - first >= 300
    );
};
