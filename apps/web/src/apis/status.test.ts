import { describe, expect, it } from "vitest";
import { media, recent, type StatusApiDependencies } from "./status.js";
import type { MediaView } from "@replay/application";

const view: MediaView = {
  videoAssetId: "11111111-1111-4111-8111-111111111111",
  videoStatus: "VALID",
  validationErrorCode: null,
  analysis: null,
};

const dependencies: StatusApiDependencies = {
  resolve: async (token) => token === "session-token" ? { sessionId: "33333333-3333-4333-8333-333333333333" } : null,
  status: async () => view,
  latest: async () => ({ videoAssetId: "11111111-1111-4111-8111-111111111111" }),
};

describe("media status API", () => {
  it("returns an owned media view", async () => {
    const response = await media(
      new Request("http://localhost/api/uploads/11111111-1111-4111-8111-111111111111", {
        headers: { cookie: "replay_session=session-token" },
      }),
      { videoAssetId: "11111111-1111-4111-8111-111111111111" },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(view);
  });

  it("rejects a missing anonymous session", async () => {
    const response = await media(
      new Request("http://localhost/api/uploads/11111111-1111-4111-8111-111111111111"),
      { videoAssetId: "11111111-1111-4111-8111-111111111111" },
      dependencies,
    );

    expect(response.status).toBe(401);
  });

  it("returns the latest owned video identifier", async () => {
    const response = await recent(
      new Request("http://localhost/api/uploads/latest", {
        headers: { cookie: "replay_session=session-token" },
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ videoAssetId: "11111111-1111-4111-8111-111111111111" });
  });
});
