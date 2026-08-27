import { describe, expect, it } from "vitest";
import {
  completion,
  upload,
  type Clock,
  type CompleteUploadRepository,
  type CompleteUploadStorage,
  type CreateUploadRepository,
  type CreateUploadStorage,
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

class UploadStorageFake implements CreateUploadStorage {
  readonly requests: Array<Parameters<CreateUploadStorage["grant"]>[0]> = [];
  readonly cleaned: string[] = [];

  async grant(request: Parameters<CreateUploadStorage["grant"]>[0]) {
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

class UploadRepoFake implements CreateUploadRepository {
  readonly commands: Array<Parameters<CreateUploadRepository["intent"]>[0]> = [];
  result: Awaited<ReturnType<CreateUploadRepository["intent"]>> = { kind: "CREATED" as const, uploadIntentId: INTENT_ID };

  async intent(command: Parameters<CreateUploadRepository["intent"]>[0]) {
    this.commands.push(command);
    return this.result;
  }
}

class CompletionStorageFake implements CompleteUploadStorage {
  readonly objectKeys: string[] = [];
  headResult: Awaited<ReturnType<CompleteUploadStorage["head"]>> = {
    sizeBytes: 50,
    contentSha256: Uint8Array.from([1, 2, 3]),
  };

  async head(objectKey: string) {
    this.objectKeys.push(objectKey);
    return this.headResult;
  }
}

class CompletionRepoFake implements CompleteUploadRepository {
  intent: Awaited<ReturnType<CompleteUploadRepository["owned"]>> = {
    uploadIntentId: INTENT_ID,
    anonymousSessionId: SESSION_ID,
    objectKey: "temporary/session/video.mp4",
    expectedSizeBytes: 50,
    declaredContentType: "video/mp4",
    expiresAt: "2026-08-24T00:15:00.000Z",
  };
  readonly commands: Array<Parameters<CompleteUploadRepository["complete"]>[0]> = [];

  async owned() {
    return this.intent;
  }

  async complete(command: Parameters<CompleteUploadRepository["complete"]>[0]) {
    this.commands.push(command);
    return { kind: "COMPLETED" as const, videoAssetId: VIDEO_ID };
  }
}

describe("upload", () => {
  it("creates a short-lived private upload grant and intent command", async () => {
    const storage = new UploadStorageFake();
    const repository = new UploadRepoFake();
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

  it("cleans up the grant when the session cannot be persisted", async () => {
    const storage = new UploadStorageFake();
    const repository = new UploadRepoFake();
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
    const storage = new UploadStorageFake();
    const repository = new UploadRepoFake();
    const operation = upload({ clock, policy: POLICY, storage, repository });

    await expect(operation({ anonymousSessionId: "bad", expectedSizeBytes: 50, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_ID" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 0, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "INVALID_SIZE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: POLICY.maxBytes + 1, declaredContentType: "video/mp4", rightsConfirmed: true })).resolves.toEqual({ kind: "INVALID_SIZE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 50, declaredContentType: "video/webm", rightsConfirmed: true })).resolves.toEqual({ kind: "UNSUPPORTED_CONTENT_TYPE" });
    await expect(operation({ anonymousSessionId: SESSION_ID, expectedSizeBytes: 50, declaredContentType: "video/mp4", rightsConfirmed: false })).resolves.toEqual({ kind: "RIGHTS_NOT_CONFIRMED" });
    expect(storage.requests).toHaveLength(0);
    expect(repository.commands).toHaveLength(0);
  });
});

describe("completeUpload", () => {
  it("heads the private object and creates a validating video asset command", async () => {
    const storage = new CompletionStorageFake();
    const repository = new CompletionRepoFake();
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
    const storage = new CompletionStorageFake();
    const repository = new CompletionRepoFake();
    const operation = completion({ clock, policy: POLICY, storage, repository });

    repository.intent = null;
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_NOT_FOUND" });

    repository.intent = {
      uploadIntentId: INTENT_ID,
      anonymousSessionId: SESSION_ID,
      objectKey: "temporary/session/video.mp4",
      expectedSizeBytes: 50,
      declaredContentType: "video/mp4",
      expiresAt: "2026-08-24T00:15:00.000Z",
    };
    storage.headResult = null;
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_NOT_READY" });

    storage.headResult = { sizeBytes: 49, contentSha256: Uint8Array.from([1, 2, 3]) };
    await expect(operation({ anonymousSessionId: SESSION_ID, uploadIntentId: INTENT_ID })).resolves.toEqual({ kind: "UPLOAD_INVALID" });
    expect(repository.commands).toHaveLength(0);
  });
});
