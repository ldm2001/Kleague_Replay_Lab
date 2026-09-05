import { describe, expect, it } from "vitest";
import {
  completion,
  upload,
  type Clock,
  type UploadCompletionStore,
  type CompletionStorage,
  type UploadIntentStore,
  type UploadStorage,
  type UploadPolicy,
} from "@replay/application";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const INTENT_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-24T00:00:00.000Z");

const POLICY: UploadPolicy = {
  maxBytes: 100 * 1024 * 1024,
  allowedContentTypes: ["video/mp4"],
  uploadIntentTtlMs: 15 * 60 * 1000,
  sourceTtlMs: 2 * 60 * 60 * 1000,
  mediaPolicyVersion: "media-v1",
  validationJobPayloadVersion: 1,
  validationMaxAttempts: 3,
};

const clock: Clock = { now: () => NOW };

class StorageDouble implements UploadStorage {
  readonly requests: Array<Parameters<UploadStorage["grant"]>[0]> = [];
  readonly cleaned: string[] = [];

  async grant(request: Parameters<UploadStorage["grant"]>[0]) {
    this.requests.push(request);
    return {
      objectKey: "temporary/session/video.mp4",
      uploadUrl: "https://storage.test/upload-token",
      expiresAt: "2026-08-24T00:15:00.000Z",
    };
  }

  async cleanup(objectKey: string) {
    this.cleaned.push(objectKey);
  }
}

class IntentDouble implements UploadIntentStore {
  readonly commands: Array<Parameters<UploadIntentStore["intent"]>[0]> = [];
  result: Awaited<ReturnType<UploadIntentStore["intent"]>> = { kind: "CREATED" as const, uploadIntentId: INTENT_ID };

  async intent(command: Parameters<UploadIntentStore["intent"]>[0]) {
    this.commands.push(command);
    return this.result;
  }
}

class ObjectDouble implements CompletionStorage {
  readonly objectKeys: string[] = [];
  headResult: Awaited<ReturnType<CompletionStorage["head"]>> = {
    sizeBytes: 50,
    contentSha256: Uint8Array.from([1, 2, 3]),
  };

  async head(objectKey: string) {
    this.objectKeys.push(objectKey);
    return this.headResult;
  }
}

class CompletionDouble implements UploadCompletionStore {
  intent: Awaited<ReturnType<UploadCompletionStore["owned"]>> = {
    uploadIntentId: INTENT_ID,
    anonymousSessionId: SESSION_ID,
    objectKey: "temporary/session/video.mp4",
    expectedSizeBytes: 50,
    declaredContentType: "video/mp4",
    competition: "K리그1",
    season: "2026",
    expiresAt: "2026-08-24T00:15:00.000Z",
  };
  readonly commands: Array<Parameters<UploadCompletionStore["complete"]>[0]> = [];

  async owned() {
    return this.intent;
  }

  async complete(command: Parameters<UploadCompletionStore["complete"]>[0]) {
    this.commands.push(command);
    return { kind: "COMPLETED" as const, videoAssetId: VIDEO_ID };
  }
}

describe("upload", () => {
  it("creates a short-lived private upload grant and intent command", async () => {
    const storage = new StorageDouble();
    const repository = new IntentDouble();
    const operation = upload({ clock, policy: POLICY, storage, repository });

    const result = await operation({
      anonymousSessionId: SESSION_ID,
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      rightsConfirmed: true,
    });

    expect(result).toEqual({
      kind: "CREATED",
      uploadIntentId: INTENT_ID,
      objectKey: "temporary/session/video.mp4",
      uploadUrl: "https://storage.test/upload-token",
      expiresAt: "2026-08-24T00:15:00.000Z",
    });
    expect(repository.commands[0]).toMatchObject({
      anonymousSessionId: SESSION_ID,
      objectKey: "temporary/session/video.mp4",
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      rightsConfirmedAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-08-24T00:15:00.000Z",
      mediaPolicyVersion: "media-v1",
    });
    expect(storage.requests[0]?.expiresAt).toBe("2026-08-24T00:15:00.000Z");
  });

  it("keeps the selected competition context in the intent command", async () => {
    const storage = new StorageDouble();
    const repository = new IntentDouble();
    const operation = upload({ clock, policy: POLICY, storage, repository });

    await operation({
      anonymousSessionId: SESSION_ID,
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      rightsConfirmed: true,
      competition: "K리그2",
      season: "2026",
    });

    expect(repository.commands[0]).toMatchObject({ competition: "K리그2", season: "2026" });
  });

  it("cleans up the grant when the session cannot be persisted", async () => {
    const storage = new StorageDouble();
    const repository = new IntentDouble();
    repository.result = { kind: "SESSION_UNAVAILABLE" };

    const result = await upload({ clock, policy: POLICY, storage, repository })({
      anonymousSessionId: SESSION_ID,
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      rightsConfirmed: true,
    });

    expect(result).toEqual({ kind: "SESSION_UNAVAILABLE" });
    expect(storage.cleaned).toEqual(["temporary/session/video.mp4"]);
  });

  it("rejects invalid size, content type, rights, and session before external ports", async () => {
    const storage = new StorageDouble();
    const repository = new IntentDouble();
    const operation = upload({ clock, policy: POLICY, storage, repository });

    await expect(operation({ anonymousSessionId: "bad", expectedSizeBytes: 50, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_ID" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 0, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_SIZE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: POLICY.maxBytes + 1, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_SIZE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 50, declaredContentType: "video/webm", rightsConfirmed: true })).resolves.toEqual({ kind: "UNSUPPORTED_CONTENT_TYPE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 50, declaredContentType: "video/mp4", rightsConfirmed: false })).resolves.toEqual({ kind: "RIGHTS_NOT_CONFIRMED" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 50, declaredContentType: "video/mp4", rightsConfirmed: true, competition: "K리그3", season: "2026" })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "COMPETITION" });
    expect(storage.requests).toHaveLength(0);
    expect(repository.commands).toHaveLength(0);
  });
});

describe("completeUpload", () => {
  it("heads the private object and creates a validating video asset command", async () => {
    const storage = new ObjectDouble();
    const repository = new CompletionDouble();
    const operation = completion({ clock, policy: POLICY, storage, repository });

    const result = await operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID });

    expect(result).toEqual({ kind: "COMPLETED", videoAssetId: VIDEO_ID });
    expect(storage.objectKeys).toEqual(["temporary/session/video.mp4"]);
    expect(repository.commands[0]).toMatchObject({
      uploadIntentId: INTENT_ID,
      anonymousSessionId: SESSION_ID,
      sizeBytes: 50,
      contentSha256: Uint8Array.from([1, 2, 3]),
      expiresAt: "2026-08-24T02:00:00.000Z",
      mediaPolicyVersion: "media-v1",
      validationJobPayloadVersion: 1,
      validationMaxAttempts: 3,
    });
  });

  it("rejects missing intent, missing object, and size mismatch without completing", async () => {
    const storage = new ObjectDouble();
    const repository = new CompletionDouble();
    const operation = completion({ clock, policy: POLICY, storage, repository });

    repository.intent = null;
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_NOT_FOUND" });

    repository.intent = {
      uploadIntentId: INTENT_ID,
      anonymousSessionId: SESSION_ID,
      objectKey: "temporary/session/video.mp4",
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      competition: "K리그1",
      season: "2026",
      expiresAt: "2026-08-24T00:15:00.000Z",
    };
    storage.headResult = null;
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_NOT_READY" });

    storage.headResult = { sizeBytes: 49, contentSha256: Uint8Array.from([1, 2, 3]) };
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_INVALID" });
    expect(repository.commands).toHaveLength(0);
  });
});
