import { describe, expect, it } from "vitest";
import { completeApi, uploadApi, type UploadApiDependencies } from "./upload-routes.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const INTENT_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";

const dependencies = (): UploadApiDependencies => ({
  issue: async () => ({ sessionId: SESSION_ID, token: "session-token" }),
  resolve: async () => ({ sessionId: SESSION_ID }),
  upload: async () => ({
    kind: "CREATED",
    uploadIntentId: INTENT_ID,
    objectKey: "uploads/session/object.upload",
    uploadUrl: "http://minio.test/upload-token",
    expiresAt: "2030-01-01T13:00:00.000Z",
  }),
  complete: async () => ({ kind: "COMPLETED", videoAssetId: VIDEO_ID }),
});

describe("upload API", () => {
  it("issues an HttpOnly session cookie only when a new session is needed", async () => {
    const response = await uploadApi(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify({ expectedSizeBytes: 128, declaredContentType: "video/mp4", rightsConfirmed: true }),
        headers: { "content-type": "application/json" },
      }),
      { ...dependencies(), resolve: async () => null },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("replay_session=session-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.json()).toMatchObject({ kind: "CREATED", uploadIntentId: INTENT_ID });
  });

  it("does not issue a session or call the use case for invalid JSON", async () => {
    let called = false;
    const deps = { ...dependencies(), upload: async () => { called = true; return { kind: "SESSION_UNAVAILABLE" as const }; } };

    const response = await uploadApi(
      new Request("http://localhost/api/uploads", { method: "POST", body: "not-json" }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(called).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("complete API", () => {
  it("returns unauthorized without a valid session", async () => {
    const deps = { ...dependencies(), resolve: async () => null };

    const response = await completeApi(
      new Request("http://localhost/api/uploads/intent/complete", { method: "POST" }),
      { intentId: INTENT_ID },
      deps,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
  });

  it("returns an accepted completion response without adding layout concerns to the API", async () => {
    const response = await completeApi(
      new Request("http://localhost/api/uploads/intent/complete", {
        method: "POST",
        headers: { cookie: "replay_session=session-token" },
      }),
      { intentId: INTENT_ID },
      dependencies(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ kind: "COMPLETED", videoAssetId: VIDEO_ID });
  });
});
