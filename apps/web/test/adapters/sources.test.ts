import { describe, expect, it } from "vitest";
import { knownVideoSource } from "../../src/adapters/sources";

// 원본 시험용 지정 문자열 준비
const SOURCE = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";

describe("known video source context", () => {
    it("resolves the registered original bytes to the independently checked match identity", () => {
        // 영상 원본 결과의 원본 해시 및 대회 지정 문자열 및 시즌 2026 및 지정 항목 20 자료의 필드 일치 확인
        expect(knownVideoSource(SOURCE)).toMatchObject({
            sourceSha256: SOURCE, competition: "K리그2", season: "2026", round: 20,
            matchDate: "2026-08-01", home: "충북청주", away: "수원", scoreHome: 2, scoreAway: 2,
            verification: "REGISTERED_SOURCE_HASH", verifiedIfabVersionId: null,
        });
    });

    it("does not guess a league, season or match for unregistered bytes or a title", () => {
        // 4개 항목 목록의 각 사례 순회
        for (const value of ["ab".repeat(32), "[2026 K리그1] 20R 경기.mp4", "", "g".repeat(64)]) {
            // 영상 원본 결과의 빈 값 확인
            expect(knownVideoSource(value)).toBeNull();
        }
    });

    it("normalizes hexadecimal case without changing the identity and protects provenance", () => {
        // 원본 시험용 영상 원본 결과 준비
        const source = knownVideoSource(SOURCE)!;
        // 영상 원본 결과의 기대값 원본 일치 확인
        expect(knownVideoSource(SOURCE.toUpperCase())).toBe(source);
        // 원본 원본의 항목 수 2 확인
        expect(source.sourceUrls).toHaveLength(2);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(source)).toBe(true);
        // 객체 동결여부 결과의 기대값 참 일치 확인
        expect(Object.isFrozen(source.sourceUrls)).toBe(true);
    });
});
