import { describe, expect, it } from "vitest";
import { knownVideoSource } from "../../src/adapters/known-video-sources";

const SOURCE = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";

describe("known video source context", () => {
  it("resolves the registered original bytes to the independently checked match identity", () => {
    expect(knownVideoSource(SOURCE)).toMatchObject({
      sourceSha256: SOURCE, competition: "K리그2", season: "2026", round: 20,
      matchDate: "2026-08-01", home: "충북청주", away: "수원", scoreHome: 2, scoreAway: 2,
      verification: "REGISTERED_SOURCE_HASH", verifiedIfabVersionId: null,
    });
  });

  it("does not guess a league, season or match for unregistered bytes or a title", () => {
    for (const value of ["ab".repeat(32), "[2026 K리그1] 20R 경기.mp4", "", "g".repeat(64)]) {
      expect(knownVideoSource(value)).toBeNull();
    }
  });

  it("normalizes hexadecimal case without changing the identity and protects provenance", () => {
    const source = knownVideoSource(SOURCE)!;
    expect(knownVideoSource(SOURCE.toUpperCase())).toBe(source);
    expect(source.sourceUrls).toHaveLength(2);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.sourceUrls)).toBe(true);
  });
});
