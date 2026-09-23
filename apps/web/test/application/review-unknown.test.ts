import { describe, expect, it } from "vitest";
import { reviewFacts, reviewValues } from "../../src/constant/review";
import { judgment } from "../fixtures/result";

describe("legacy review nullable observations", () => {
    it("round-trips null booleans without declaring false observations", () => {
        // 값 시험용 깊은복사 결과 준비
        const value = structuredClone(judgment.facts);
        // 값 추가 접촉감지여부 값을 빈 값 값으로 설정
        value.push.contactDetected.value = null;
        // 값 추가 페널티구역내부여부 값을 빈 값 값으로 설정
        value.push.insidePenaltyArea.value = null;
        // 값 변수 재개를 빈 값 값으로 설정
        value.variable.restartOccurred = null;
        // 값 변수 대상착오를 빈 값 값으로 설정
        value.variable.mistakenIdentity = null;
        // 값 변수 사건을 빈 값 값으로 설정
        value.variable.seriousMissedIncident = null;
        // 시험자료 시험용 사실 결과 준비
        const roundtrip = reviewFacts(reviewValues(value), [
            "11111111-1111-4111-8111-111111111111"
        ]);
        // 사실 반환값의 값 존재 확인
        expect(roundtrip).not.toBeNull();
        // 사실 반환값 추가 접촉감지여부 값의 빈 값 확인
        expect(roundtrip?.push.contactDetected.value).toBeNull();
        // 사실 반환값 추가 페널티구역내부여부 값의 빈 값 확인
        expect(roundtrip?.push.insidePenaltyArea.value).toBeNull();
        // 사실 반환값 변수 재개의 빈 값 확인
        expect(roundtrip?.variable.restartOccurred).toBeNull();
        // 사실 반환값 변수 대상착오의 빈 값 확인
        expect(roundtrip?.variable.mistakenIdentity).toBeNull();
        // 사실 반환값 변수 사건의 빈 값 확인
        expect(roundtrip?.variable.seriousMissedIncident).toBeNull();
    });
});
