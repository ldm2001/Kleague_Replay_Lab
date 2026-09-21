import { describe, expect, it } from "vitest";
import { reviewFacts, reviewValues } from "../../src/constant/review";
import { judgment } from "../fixtures/result";

describe("legacy review nullable observations", () => {
  it("round-trips null booleans without declaring false observations", () => {
    const value = structuredClone(judgment.facts);
    value.push.contactDetected.value = null;
    value.push.insidePenaltyArea.value = null;
    value.variable.restartOccurred = null;
    value.variable.mistakenIdentity = null;
    value.variable.seriousMissedIncident = null;
    const roundtrip = reviewFacts(reviewValues(value), ["11111111-1111-4111-8111-111111111111"]);
    expect(roundtrip).not.toBeNull();
    expect(roundtrip?.push.contactDetected.value).toBeNull();
    expect(roundtrip?.push.insidePenaltyArea.value).toBeNull();
    expect(roundtrip?.variable.restartOccurred).toBeNull();
    expect(roundtrip?.variable.mistakenIdentity).toBeNull();
    expect(roundtrip?.variable.seriousMissedIncident).toBeNull();
  });
});
