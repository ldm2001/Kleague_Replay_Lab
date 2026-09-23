// 규정 게이트 테스트
import type { PushFacts } from "@replay/shared-types";
import { observation } from "@replay/shared-types";
import { ruleSet } from "@replay/rule-data";
import { describe, expect, it } from "vitest";
import { pushGates, discipline } from "@replay/rule-engine";
import { context } from "../fixtures/push-context";

// 규정목록 시험용 규정집 결과 준비
const rules = ruleSet("ifab-2025-26")!;

// 기본자료 시험 입력으로 접촉감지여부 및 강도 및 상대이동 및 페널티구역내부여부 자료 생성
const base: PushFacts = {
    contactDetected: observation(true, "NORMAL", ["shot-1"]),
    severity: observation("RECKLESS", "NORMAL", ["shot-1"]),
    opponentDisplacement: observation("clear", "NORMAL", ["shot-1"]),
    insidePenaltyArea: observation(false, "NORMAL", ["shot-1"]),
    cameraSufficiency: "HIGH",
    context: context(),
};

describe("pushGates", () => {
    it("각도가 부족하면 어떤 사실값이 들어와도 INCONCLUSIVE로 고정된다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates({ ...base, cameraSufficiency: "LOW" }, rules);
        // 결과의 판단 불가 상태 일치 확인
        expect(verdict.decision).toBe("INCONCLUSIVE");
        // 결과의 화면 정보 부족 상태 일치 확인
        expect(verdict.inconclusiveReason).toBe("CAMERA_INSUFFICIENT");
        // 판단 강도의 빈 값 확인
        expect(verdict.severity).toBeNull();
        // 판단 확신도의 기대값 낮음 일치 확인
        expect(verdict.confidence).toBe("LOW");
    });

    it("접촉이 없으면 파울이 아니며 속도 게이트를 거치지 않는다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates(
            {
                ...base,
                contactDetected: observation(false, "SLOW", ["shot-2"]),
                severity: observation("uncertain", "SLOW", ["shot-2"])
            },
            rules
        );
        // 결과가 파울 아님 상태로 유지됨 확인
        expect(verdict.decision).toBe("NO_FOUL");
        // 판단 재개의 기대값 지정 문자열 일치 확인
        expect(verdict.restart).toBe("PLAY_CONTINUED");
    });

    it("강도를 슬로우모션에서만 봤으면 판정하지 않고 근거로 VAR 프로토콜을 든다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates(
            { ...base, severity: observation("EXCESSIVE_FORCE", "SLOW", ["shot-2"]) },
            rules
        );
        // 결과의 판단 불가 상태 일치 확인
        expect(verdict.decision).toBe("INCONCLUSIVE");
        // 판단 사유의 기대값 지정 문자열 일치 확인
        expect(verdict.inconclusiveReason).toBe("SLOW_MOTION_ONLY");
        // 판단 인용목록 일부충족 결과의 기대값 참 일치 확인
        expect(verdict.citations.some((citation) => citation.law === "VAR")).toBe(true);
    });

    it("관측 속도가 UNKNOWN인 강도도 승인하지 않는다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates(
            { ...base, severity: observation("RECKLESS", "UNKNOWN", []) },
            rules
        );
        // 판단 사유의 기대값 지정 문자열 일치 확인
        expect(verdict.inconclusiveReason).toBe("SLOW_MOTION_ONLY");
    });

    it("밀림이 possible이면 파울로 단정하지 않는다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates(
            { ...base, opponentDisplacement: observation("possible", "NORMAL", ["shot-1"]) },
            rules
        );
        // 결과의 판단 불가 상태 일치 확인
        expect(verdict.decision).toBe("INCONCLUSIVE");
        // 결과가 접촉 강도 미확정 상태로 유지됨 확인
        expect(verdict.inconclusiveReason).toBe("SEVERITY_UNDETERMINED");
    });

    it("확정된 부주의한 밀기를 밀림 없음으로 면책하지 않는다", () => {
        // 판단 시험용 밀기전제조건 결과 준비
        const verdict = pushGates(
            {
                ...base,
                severity: observation("CARELESS", "NORMAL", ["shot-1"]),
                opponentDisplacement: observation("none", "NORMAL", ["shot-1"])
            },
            rules
        );
        // 판단 판정의 기대값 파울 일치 확인
        expect(verdict.decision).toBe("FOUL");
        // 판단 재개의 기대값 직접프리킥 일치 확인
        expect(verdict.restart).toBe("DIRECT_FREE_KICK");
        // 판단 징계의 기대값 없음 일치 확인
        expect(verdict.disciplinary).toBe("NONE");
    });

    it("페널티지역 안팎이 재개 방식을 가른다", () => {
        // 밀기전제조건 결과 재개의 기대값 직접프리킥 일치 확인
        expect(pushGates(base, rules).restart).toBe("DIRECT_FREE_KICK");
        // 밀기전제조건 결과 재개의 기대값 페널티킥 일치 확인
        expect(
            pushGates(
                {
                    ...base,
                    context: context(true),
                    insidePenaltyArea: observation(true, "NORMAL", ["shot-1"])
                },
                rules
            ).restart
        ).toBe("PENALTY_KICK");
    });

    it.each(["contactDetected", "insidePenaltyArea"] as const)(
        "%s 미확인을 false로 바꾸지 않는다",
        (key) => {
            // 결과 시험용 밀기전제조건 결과 준비
            const result = pushGates({ ...base, [key]: observation(null, "NORMAL", []) }, rules);
            // 결과의 판단 불가 상태 일치 확인
            expect(result.decision).toBe("INCONCLUSIVE");
            // 결과 재개의 빈 값 확인
            expect(result.restart).toBeNull();
            // 결과 징계의 빈 값 확인
            expect(result.disciplinary).toBeNull();
        }
    );

    it("과거 입력의 누락된 맥락을 기본값으로 만들지 않는다", () => {
        // 맥락 맥락 기존형식 시험용 기본자료 준비
        const { context: _context, ...legacy } = base;
        // 판단 불가 내용을 포함한 기대 결과 일치 확인
        expect(pushGates(legacy, rules)).toMatchObject({
            decision: "INCONCLUSIVE",
            restart: null,
            disciplinary: null,
            inconclusiveReason: "FACTS_UNDETERMINED"
        });
    });

    it.each(["ballInPlay", "onField", "againstOpponent", "insideOwnPenaltyArea"] as const)(
        "맥락 %s 미확인은 판정을 보류한다",
        (key) => {
            // 결과 시험용 밀기전제조건 결과 준비
            const result = pushGates(
                { ...base, context: { ...context(), [key]: observation(null, "NORMAL", []) } },
                rules
            );
            // 결과의 판단 불가 상태 일치 확인
            expect(result.decision).toBe("INCONCLUSIVE");
            // 결과 재개의 빈 값 확인
            expect(result.restart).toBeNull();
        }
    );

    it.each(["ballInPlay", "onField", "againstOpponent"] as const)(
        "지원하지 않는 %s=false 맥락에서는 확정하지 않는다",
        (key) => {
            // 결과 시험용 밀기전제조건 결과 준비
            const result = pushGates(
                { ...base, context: { ...context(), [key]: observation(false, "NORMAL", []) } },
                rules
            );
            // 판단 불가 내용을 포함한 기대 결과 일치 확인
            expect(result).toMatchObject({
                decision: "INCONCLUSIVE",
                restart: null,
                disciplinary: null
            });
        }
    );

    it.each(["DOGSO", "SPA", "UNKNOWN"] as const)(
        "별도 징계 맥락 %s를 단순 강도로 대체하지 않는다",
        (value) => {
            // 결과 시험용 밀기전제조건 결과 준비
            const result = pushGates(
                {
                    ...base,
                    context: { ...context(), disciplinaryContext: observation(value, "NORMAL", []) }
                },
                rules
            );
            // 판단 불가 내용을 포함한 기대 결과 일치 확인
            expect(result).toMatchObject({
                decision: "INCONCLUSIVE",
                restart: null,
                disciplinary: null
            });
        }
    );

    it("상대 구역의 반칙을 페널티킥으로 바꾸지 않는다", () => {
        // 결과 시험용 밀기전제조건 결과 준비
        const result = pushGates(
            { ...base, insidePenaltyArea: observation(true, "NORMAL", []) },
            rules
        );
        // 결과 재개의 기대값 직접프리킥 일치 확인
        expect(result.restart).toBe("DIRECT_FREE_KICK");
    });

    it("구역 관측이 충돌하면 확정하지 않는다", () => {
        // 밀기전제조건 결과 재개의 빈 값 확인
        expect(pushGates({ ...base, context: context(true) }, rules).restart).toBeNull();
    });

    it("강도가 징계 등급을 정한다", () => {
        // 시험자료 결과의 기대값 없음 일치 확인
        expect(discipline("CARELESS")).toBe("NONE");
        // 시험자료 결과의 기대값 지정 문자열 일치 확인
        expect(discipline("RECKLESS")).toBe("CAUTION");
        // 시험자료 결과의 기대값 전송 일치 확인
        expect(discipline("EXCESSIVE_FORCE")).toBe("SEND_OFF");
        // 전송 시험용 밀기전제조건 결과 준비
        const sendOff = pushGates(
            { ...base, severity: observation("EXCESSIVE_FORCE", "NORMAL", ["shot-1"]) },
            rules
        );
        // 전송 판정의 기대값 파울 일치 확인
        expect(sendOff.decision).toBe("FOUL");
        // 전송 징계의 기대값 전송 일치 확인
        expect(sendOff.disciplinary).toBe("SEND_OFF");
        // 전송 강도의 기대값 지정 문자열 일치 확인
        expect(sendOff.severity).toBe("EXCESSIVE_FORCE");
    });

    it("어떤 경로로 나가도 인용이 최소 하나 붙는다", () => {
        // 입력목록 시험용 6개 항목 목록 준비
        const inputs: PushFacts[] = [
            { ...base, cameraSufficiency: "LOW" },
            { ...base, contactDetected: observation(false, "NORMAL", ["shot-1"]) },
            { ...base, severity: observation("RECKLESS", "SLOW", ["shot-2"]) },
            { ...base, severity: observation("uncertain", "NORMAL", ["shot-1"]) },
            {
                ...base,
                severity: observation("CARELESS", "NORMAL", ["shot-1"]),
                opponentDisplacement: observation("none", "NORMAL", ["shot-1"])
            },
            base
        ];
        // 입력목록의 각 사례 순회
        for (const facts of inputs) {
            // 밀기전제조건 결과 인용목록 길이의 1 이상 확인
            expect(pushGates(facts, rules).citations.length).toBeGreaterThanOrEqual(1);
        }
    });
});
