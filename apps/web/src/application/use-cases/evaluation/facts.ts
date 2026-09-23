// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 사실과 규정을 대조하는 평가 기능 가져옴
import type { EvaluationStore, FactPatchResult } from "../../ports/repositories/evaluation-store";
// 공유 자료 계약과 검증 기능 가져옴
import type { EvaluationFacts, PushFacts } from "@replay/shared-types";
// 공유 자료 계약과 검증 기능 가져옴
import {
    CAMERA_SUFFICIENCY_LEVELS,
    DECISION_NATURES,
    DISCIPLINARY_ACTIONS,
    DISPLACEMENT_LEVELS,
    ERROR_MAGNITUDES,
    GOAL_DECISIONS,
    OBSERVATION_SPEEDS,
    OBSERVED_SEVERITIES,
    OBSERVED_SOURCES,
    RESTART_BENEFICIARIES,
    RESTART_TYPES,
    REVIEW_SCENARIOS,
    SEND_OFF_CATEGORIES
} from "@replay/shared-types";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 중복 처리 방지 키의 바이트 길이 상한 지정
const KEY_MAX = 200;

// 사실 입력
export type FactInput = Readonly<{
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymousSessionId: string;
    // 분석 기록의 식별자
    analysisId: string;
    // 사실 또는 평가와 연결할 후보 식별자
    candidateId: string;
    // 동시 수정 충돌 확인용 예상 사실 판본
    expectedFactRevisionId?: string | null;
    // 재요청을 중복 실행하지 않기 위한 키
    idempotencyKey: string;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: unknown;
}>;

// 사실 결과 정의
export type FactResult =
    FactPatchResult | Readonly<{ kind: "INVALID_INPUT"; reason: "ID" | "KEY" | "FACTS" }>;

// 사실 의존 기능 계약 정의
export type FactDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: EvaluationStore;
}>;

// 객체 형식 확인
const object = (value: unknown): value is Record<string, unknown> =>
    // 배열이 아닌 객체 확인
    typeof value === "object" && value !== null && !Array.isArray(value);

// 허용 목록의 단일 값 확인
const one = <T extends string>(value: unknown, values: readonly T[]): value is T =>
    // 허용 목록의 단일 값 확인
    typeof value === "string" && values.includes(value as T);

// 관측값·재생 속도·샷 참조 확인
const observed = (value: unknown, check: (value: unknown) => boolean): boolean => {
    // 관측 사실 객체 확인
    if (!object(value) || !check(value.value) || !one(value.observedAtSpeed, OBSERVATION_SPEEDS))
        // 관측 원심 자료의 형식 부적합 반환
        return false;
    // 관측 사실의 장면 식별자 확인
    return (
        Array.isArray(value.shotIds) &&
        value.shotIds.every((item) => typeof item === "string" && UUID.test(item))
    );
};

// 미확정 또는 불리언 값 확인
const nullableBoolean = (value: unknown): boolean => value === null || typeof value === "boolean";

// 경기 문맥의 관측 구조 확인
const validContext = (value: unknown): boolean =>
    object(value) &&
    Object.keys(value).every((key) =>
        [
            "ballInPlay",
            "onField",
            "againstOpponent",
            "insideOwnPenaltyArea",
            "offenderRole",
            "disciplinaryContext"
        ].includes(key)
    ) &&
    ["ballInPlay", "onField", "againstOpponent", "insideOwnPenaltyArea"].every((key) =>
        observed(value[key], nullableBoolean)
    ) &&
    observed(value.offenderRole, (item) =>
        one(item, ["ATTACKING_TEAM", "DEFENDING_TEAM", "UNKNOWN"])
    ) &&
    observed(value.disciplinaryContext, (item) => one(item, ["NONE", "DOGSO", "SPA", "UNKNOWN"]));

// 밀기 관련 관측값과 문맥 형식 확인
export const pushFactsData = (push: unknown): push is PushFacts => object(push) &&
    observed(push.contactDetected, nullableBoolean) &&
    observed(push.severity, (item) => one(item, OBSERVED_SEVERITIES)) &&
    observed(push.opponentDisplacement, (item) => one(item, DISPLACEMENT_LEVELS)) &&
    observed(push.insidePenaltyArea, nullableBoolean) &&
    (push.context === undefined || validContext(push.context)) &&
    one(push.cameraSufficiency, CAMERA_SUFFICIENCY_LEVELS);

// 판정 입력 사실 묶음의 구조 확인
const validFacts = (value: unknown): value is EvaluationFacts => {
    // 사실 묶음의 최상위 구조 확인
    if (!object(value) || !object(value.push) || !object(value.variable) || !object(value.observed))
        // 필요한 사실 묶음이 없는 입력 거부 반환
        return false;
    // 제출 사실에서 밀기 질문 관련 관측 읽음
    const push = value.push;
    // 제출 사실에서 영상 판독 적용 조건 읽음
    const variable = value.variable;
    // 규정 판단과 비교할 관측 원심 읽음
    const decision = value.observed;
    // 밀기와 영상 판독 조건 및 원심 값의 허용 형식 대조 결과 반환
    return (
        pushFactsData(push) &&
        one(variable.reviewScenario, REVIEW_SCENARIOS) &&
        nullableBoolean(variable.restartOccurred) &&
        one(variable.sendOffCategory, SEND_OFF_CATEGORIES) &&
        nullableBoolean(variable.mistakenIdentity) &&
        one(variable.decisionNature, DECISION_NATURES) &&
        one(variable.errorMagnitude, ERROR_MAGNITUDES) &&
        nullableBoolean(variable.seriousMissedIncident) &&
        one(decision.restartType, RESTART_TYPES) &&
        one(decision.restartBeneficiary, RESTART_BENEFICIARIES) &&
        (decision.card === null || one(decision.card, DISCIPLINARY_ACTIONS)) &&
        one(decision.goalDecision, GOAL_DECISIONS) &&
        one(decision.source, OBSERVED_SOURCES)
    );
};

// 요청의 세션·분석·후보 식별자 확인
const ids = (input: FactInput): boolean =>
    [input.anonymousSessionId, input.analysisId, input.candidateId].every((value) =>
        UUID.test(value)
    );

// 사실 처리
export const facts =
    ({ clock, hasher, repository }: FactDependencies) =>
    async (input: FactInput): Promise<FactResult> => {
        // 입력 식별자 검증
        if (!ids(input)) return { kind: "INVALID_INPUT", reason: "ID" };
        // 동시 수정 검사에 사용할 예상 사실 판본 읽음
        const expected = input.expectedFactRevisionId;
        // 선택된 예상 사실 판본의 식별자 형식 확인
        if (
            expected !== undefined &&
            expected !== null &&
            (typeof expected !== "string" || !UUID.test(expected))
        ) {
            // 예상 사실 판본 식별자 오류 반환
            return { kind: "INVALID_INPUT", reason: "ID" };
        }
        // 중복 처리 방지 키의 문자열 형식 확인
        if (typeof input.idempotencyKey !== "string")
            // 중복 처리 방지 키 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "KEY" };
        // 멱등 키 바이트 길이 확인
        const keyBytes = new TextEncoder().encode(input.idempotencyKey);
        // 중복 처리 방지 키의 빈 값과 바이트 길이 상한 확인
        if (keyBytes.byteLength === 0 || keyBytes.byteLength > KEY_MAX) {
            // 중복 처리 방지 키 길이 오류 반환
            return { kind: "INVALID_INPUT", reason: "KEY" };
        }
        // 사실 묶음의 자료형과 허용 값 조건 위반 차단
        if (!validFacts(input.facts)) return { kind: "INVALID_INPUT", reason: "FACTS" };

        // 식별자 소문자 정규화
        const anonymousSessionId = input.anonymousSessionId.toLowerCase();
        // 분석 기록의 식별자의 대소문자 차이 제거
        const analysisId = input.analysisId.toLowerCase();
        // 사실 또는 평가와 연결할 후보 식별자의 대소문자 차이 제거
        const candidateId = input.candidateId.toLowerCase();
        // 미지정 값은 비워 두고 예상 사실 식별자를 소문자로 통일
        const expectedFactRevisionId = expected?.toLowerCase() ?? null;
        // 사실 요청 해시 생성
        const requestHash = Uint8Array.from(
            await hasher.sha256(JSON.stringify({ analysisId, candidateId, facts: input.facts }))
        );
        // 멱등 키 해시 생성
        const keyHash = Uint8Array.from(await hasher.sha256(input.idempotencyKey));
        // 사실 패치 저장
        return repository.patch({
            // 업로드 소유자를 구별하는 익명 세션 식별자
            anonymousSessionId,
            // 분석 기록의 식별자
            analysisId,
            // 사실 또는 평가와 연결할 후보 식별자
            candidateId,
            // 동시 수정 충돌 확인용 예상 사실 판본
            expectedFactRevisionId,
            // 확인된 출처와 판본을 보존하는 규정 사실 자료
            facts: input.facts,
            // 멱등 요청 키의 해시
            keyHash,
            // 동일 키로 다른 요청을 보냈는지 확인하는 해시
            requestHash,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString()
        });
    };
