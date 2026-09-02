import { describe, expect, it } from "vitest";
import { evidence, type EvidenceApiDependencies } from "./evidence.js";

const dependencies: EvidenceApiDependencies = {
  resolve: async (token) => token === "session-token" ? { sessionId: "33333333-3333-4333-8333-333333333333" } : null,
  asset: async () => ({ objectKey: "evidence/analysis/job/candidate.jpg", contentType: "image/jpeg" }),
  body: async () => ({
    body: {
      async *[Symbol.asyncIterator]() {
        yield Uint8Array.from([1, 2, 3]);
      },
    },
  }),
};

describe("evidence API", () => {
  it("streams owned private evidence", async () => {
    const response = await evidence(
      new Request("http://localhost/api/analyses/analysis/evidence/evidence", {
        headers: { cookie: "replay_session=session-token" },
      }),
      {
        analysisId: "22222222-2222-4222-8222-222222222222",
        evidenceId: "55555555-5555-4555-8555-555555555555",
      },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("rejects a missing session", async () => {
    const response = await evidence(
      new Request("http://localhost/api/analyses/analysis/evidence/evidence"),
      {
        analysisId: "22222222-2222-4222-8222-222222222222",
        evidenceId: "55555555-5555-4555-8555-555555555555",
      },
      dependencies,
    );

    expect(response.status).toBe(401);
  });
});
