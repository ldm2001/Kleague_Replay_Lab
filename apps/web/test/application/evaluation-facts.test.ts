// 사실 유스케이스 테스트
import { describe, expect, it } from "vitest";
import { facts, type Clock, type EvaluationStore, type Hasher } from "@replay/application";
import { observation, type EvaluationFacts } from "@replay/shared-types";
import { context } from "../fixtures/push-context";

// 세션 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION = "11111111-1111-4111-8111-111111111111";
// 분석 시험용 22222222 2222 4222 8222 222222222222 준비
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
// 후보 시험용 33333333 3333 4333 8333 333333333333 준비
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-09-03T00:00:00.000Z");

// 값 시험 입력으로 추가 및 변수 및 관측결과 자료 생성
const value: EvaluationFacts = {
    push: {
        contactDetected: observation(true, "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
        severity: observation("RECKLESS", "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
        opponentDisplacement: observation("clear", "NORMAL", [
            "44444444-4444-4444-8444-444444444444"
        ]),
        insidePenaltyArea: observation(false, "NORMAL", ["44444444-4444-4444-8444-444444444444"]),
        cameraSufficiency: "HIGH"
    },
    variable: {
        reviewScenario: "PENALTY_NOT_GIVEN",
        restartOccurred: false,
        sendOffCategory: "NONE",
        mistakenIdentity: false,
        decisionNature: "SUBJECTIVE",
        errorMagnitude: "UNDETERMINED",
        seriousMissedIncident: false
    },
    observed: {
        restartType: "PLAY_CONTINUED",
        restartBeneficiary: "NONE",
        card: null,
        goalDecision: "NOT_APPLICABLE",
        source: "USER_INPUT"
    }
};

class HashFake implements Hasher {
    // 검증용 보안 해시 구성
    async sha256(input: string) {
        // 문구 결과 반환
        return new TextEncoder().encode(input).slice(0, 8);
    }
}

class EvaluationDouble implements EvaluationStore {
    calls: unknown[] = [];

    // 검증용 수정 구성
    async patch(input: Parameters<EvaluationStore["patch"]>[0]) {
        // 입력 조건 호출기록 추가 결과 처리 수행
        this.calls.push(input);
        // 종류 및 사실 개정번호 식별자 및 개정번호 1 자료 반환
        return { kind: "CREATED" as const, factRevisionId: CANDIDATE, revision: 1 };
    }

    // 검증용 문맥 구성
    async context() { return { kind: "NO_FACTS" as const }; }

    // 검증용 저장 구성
    async save() { return { kind: "NOT_FOUND" as const }; }
}

// 시계 시험 입력으로 현재시각 자료 생성
const clock: Clock = { now: () => NOW };

describe("facts", () => {
    it("preserves unknown booleans and explicit context without false defaults", async () => {
        // 저장소 시험용 의존성 모의객체 준비
        const repository = new EvaluationDouble();
        // 시험자료 시험 입력으로 기존 항목 및 추가 및 변수 자료 생성
        const unknown = {
            ...value,
            push: {
                ...value.push,
                contactDetected: observation(null, "UNKNOWN", []),
                insidePenaltyArea: observation(null, "UNKNOWN", []),
                context: context()
            },
            variable: {
                ...value.variable,
                restartOccurred: null,
                mistakenIdentity: null,
                seriousMissedIncident: null
            }
        };
        // 사실 결과를 결과에 저장
        const result = await facts({ clock, hasher: new HashFake(), repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            idempotencyKey: "unknown",
            facts: unknown
        });
        // 결과 종류의 기대값 생성완료 일치 확인
        expect(result.kind).toBe("CREATED");
        // 저장소 호출기록 중 선택 항목의 사실 자료의 필드 일치 확인
        expect(repository.calls[0]).toMatchObject({ facts: unknown });
    });

    it.each([
        { ...context(), ballInPlay: observation("false", "NORMAL", []) },
        { ...context(), offenderRole: observation("NONE", "NORMAL", []) },
        { ...context(), disciplinaryContext: observation("LOW", "NORMAL", []) },
        { ...context(), onField: observation(true, "NORMAL", ["not-a-shot-id"]) },
        { ...context(), extra: null },
        { ballInPlay: observation(true, "NORMAL", []) },
        null
    ])("rejects malformed context rather than ignoring it", async (invalidContext) => {
        // 저장소 시험용 의존성 모의객체 준비
        const repository = new EvaluationDouble();
        // 사실 결과를 결과에 저장
        const result = await facts({ clock, hasher: new HashFake(), repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            idempotencyKey: "invalid",
            facts: { ...value, push: { ...value.push, context: invalidContext } }
        });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "INVALID_INPUT", reason: "FACTS" });
        // 저장소 호출기록의 항목 수 0 확인
        expect(repository.calls).toHaveLength(0);
    });
    it("keeps valid observed facts in a user revision command", async () => {
        // 저장소 시험용 의존성 모의객체 준비
        const repository = new EvaluationDouble();
        // 사실 결과를 결과에 저장
        const result = await facts({ clock, hasher: new HashFake(), repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            idempotencyKey: "fact-1",
            facts: value
        });

        // 결과의 종류 생성완료 및 사실 개정번호 식별자 및 개정번호 1 자료 기준 구조 일치 확인
        expect(result).toEqual({ kind: "CREATED", factRevisionId: CANDIDATE, revision: 1 });
        // 저장소 호출기록 중 선택 항목의 익명 세션 식별자 및 분석 식별자 및 후보 식별자 및 기대값 사실 개정번호 식별자 빈 값 자료의 필드 일치 확인
        expect(repository.calls[0]).toMatchObject({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            expectedFactRevisionId: null,
            facts: value
        });
    });

    it("rejects facts that are outside the shared vocabulary", async () => {
        // 저장소 시험용 의존성 모의객체 준비
        const repository = new EvaluationDouble();
        // 사실 결과를 결과에 저장
        const result = await facts({ clock, hasher: new HashFake(), repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            idempotencyKey: "fact-1",
            facts: { ...value, variable: { ...value.variable, reviewScenario: "FOUL" } }
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "INVALID_INPUT", reason: "FACTS" });
        // 저장소 호출기록의 항목 수 0 확인
        expect(repository.calls).toHaveLength(0);
    });

    it("rejects a non string expected fact revision", async () => {
        // 저장소 시험용 의존성 모의객체 준비
        const repository = new EvaluationDouble();
        // 사실 결과를 결과에 저장
        const result = await facts({ clock, hasher: new HashFake(), repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS,
            candidateId: CANDIDATE,
            expectedFactRevisionId: 7 as never,
            idempotencyKey: "fact-1",
            facts: value
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "INVALID_INPUT", reason: "ID" });
        // 저장소 호출기록의 항목 수 0 확인
        expect(repository.calls).toHaveLength(0);
    });
});
