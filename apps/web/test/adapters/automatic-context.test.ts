import { describe, expect, it } from "vitest";
import { automaticContext } from "../../src/adapters/automatic-context";

const source = "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857";
describe("automatic context selection", () => {
  it("does not query unknown sources", async () => {
    let calls = 0;
    expect(await automaticContext("a".repeat(64), async () => { calls++; return []; })).toBeNull();
    expect(calls).toBe(0);
  });
  it("rejects ambiguous matches and leaves ambiguous rules unlinked", async () => {
    expect(await automaticContext(source, async () => [{ id: "a" }, { id: "b" }])).toBeNull();
    const queue = [[{ id: "match" }], [{ id: "a" }, { id: "b" }]];
    expect(await automaticContext(source, async () => queue.shift() ?? [])).toEqual({ matchId: "match", ruleId: null });
  });
  it("links only the unique returned match and independently verified rule", async () => {
    const queue = [[{ id: "match" }], [{ id: "rule" }]];
    expect(await automaticContext(source, async () => queue.shift() ?? [])).toEqual({ matchId: "match", ruleId: "rule" });
  });
});
