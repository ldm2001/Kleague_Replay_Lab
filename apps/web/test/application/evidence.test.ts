import { describe, expect, it } from "vitest";
import {
  evidence,
  type Clock,
  type EvidenceAccess,
  type EvidenceAccessCommand,
  type EvidenceStore,
  type EvidenceGrant,
  type EvidenceGrantInput,
  type EvidenceStorage,
} from "@replay/application";

const NOW = new Date("2026-08-31T00:00:00.000Z");

// 증거 권한 저장소 모형
class EvidenceStoreFake implements EvidenceStore {
  commands: EvidenceAccessCommand[] = [];
  response: EvidenceAccess = {
    kind: "AUTHORIZED",
    analysisId: "22222222-2222-4222-8222-222222222222",
  };

  async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
    this.commands.push(command);
    return this.response;
  }
}

class Storage implements EvidenceStorage {
  inputs: EvidenceGrantInput[] = [];
  perceptionInputs: Parameters<NonNullable<EvidenceStorage["perception"]>>[0][] = [];

  async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
    this.inputs.push(input);
    return {
      objectKey: `evidence/${input.analysisId}/${input.jobId}/${input.name}`,
      uploadUrl: `http://storage.test/${input.name}`,
    };
  }

  async perception(input: Parameters<NonNullable<EvidenceStorage["perception"]>>[0]): Promise<EvidenceGrant> {
    this.perceptionInputs.push(input);
    return {
      objectKey: `perception/${input.analysisId}/${input.jobId}/${input.jobRevision}/${input.contentSha256}.jsonl.gz`,
      uploadUrl: "http://storage.test/perception",
      headers: {
        "x-amz-checksum-sha256": Buffer.from(input.contentSha256, "hex").toString("base64"),
        "if-none-match": "*",
      },
    };
  }
}

describe("evidence grants", () => {
  it("authorizes a lease and grants only bounded evidence files", async () => {
    // 유효한 Lease 증거 권한 실행
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const result = await evidence({
      clock: { now: () => NOW } satisfies Clock,
      hasher: { sha256: async () => Uint8Array.from([1, 2, 3]) },
      repository,
      storage,
    })({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      items: [{ name: "candidate-0001.jpg", contentType: "image/jpeg", sizeBytes: 128 }],
    });

    expect(result).toEqual({
      kind: "GRANTED",
      items: [{
        name: "candidate-0001.jpg",
        objectKey: "evidence/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/candidate-0001.jpg",
        uploadUrl: "http://storage.test/candidate-0001.jpg",
      }],
    });
    expect(repository.commands[0]).toMatchObject({
      jobId: "11111111-1111-4111-8111-111111111111",
      leaseTokenHash: Uint8Array.from([1, 2, 3]),
    });
  });

  it("rejects unsupported evidence before storage", async () => {
    // 지원하지 않는 증거 요청 실행
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const operation = evidence({
      clock: { now: () => NOW },
      hasher: { sha256: async () => Uint8Array.from([1]) },
      repository,
      storage,
    });

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      items: [{ name: "payload.exe", contentType: "application/octet-stream" as never, sizeBytes: 128 }],
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
    expect(repository.commands).toHaveLength(0);
    expect(storage.inputs).toHaveLength(0);
  });

  it("accepts evidence for every baseline candidate", async () => {
    // 후보 전체 증거 권한 실행
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const operation = evidence({
      clock: { now: () => NOW },
      hasher: { sha256: async () => Uint8Array.from([1]) },
      repository,
      storage,
    });
    const items = Array.from({ length: 48 }, (_, index) => ({
      name: `candidate-${String(index + 1).padStart(4, "0")}.jpg`,
      contentType: "image/jpeg" as const,
      sizeBytes: 128,
    }));

    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      items,
    })).resolves.toMatchObject({ kind: "GRANTED", items: items.map((item) => ({ name: item.name })) });
    expect(storage.inputs).toHaveLength(48);
  });

  it("grants one immutable checksum-bound gzip diagnostic", async () => {
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const sha256 = "a".repeat(64);
    const result = await evidence({
      clock: { now: () => NOW },
      hasher: { sha256: async () => Uint8Array.from([1]) },
      repository,
      storage,
    })({
      jobId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      jobRevision: 2,
      leaseToken: "lease-token",
      items: [{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1_024, contentSha256: sha256 }],
    });

    expect(result).toEqual({
      kind: "GRANTED",
      items: [{
        name: "observations.jsonl.gz",
        objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${sha256}.jsonl.gz`,
        uploadUrl: "http://storage.test/perception",
        headers: {
          "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
          "if-none-match": "*",
        },
      }],
    });
    expect(storage.perceptionInputs).toEqual([{
      analysisId: "22222222-2222-4222-8222-222222222222",
      jobId: "11111111-1111-4111-8111-111111111111",
      jobRevision: 2,
      contentSha256: sha256,
      sizeBytes: 1_024,
    }]);
    expect(storage.inputs).toHaveLength(0);
  });

  it("allows a 128 MiB gzip while preserving the 50 MiB media and 200 MiB request limits", async () => {
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const operation = evidence({ clock: { now: () => NOW }, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage });
    const common = { jobId: "11111111-1111-4111-8111-111111111111", workerId: "worker-1",
      jobRevision: 2, leaseToken: "lease-token" };
    await expect(operation({ ...common, items: [{ name: "observations.jsonl.gz", contentType: "application/gzip",
      sizeBytes: 128 * 1_024 * 1_024, contentSha256: "a".repeat(64) }] })).resolves.toMatchObject({ kind: "GRANTED" });
    await expect(operation({ ...common, items: [{ name: "observations.jsonl.gz", contentType: "application/gzip",
      sizeBytes: 128 * 1_024 * 1_024 + 1, contentSha256: "a".repeat(64) }] })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
    await expect(operation({ ...common, items: [{ name: "candidate.mp4", contentType: "video/mp4",
      sizeBytes: 50 * 1_024 * 1_024 + 1 }] })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
    await expect(operation({ ...common, items: [
      { name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 128 * 1_024 * 1_024, contentSha256: "a".repeat(64) },
      { name: "candidate.mp4", contentType: "video/mp4", sizeBytes: 50 * 1_024 * 1_024 },
      { name: "candidate.jpg", contentType: "image/jpeg", sizeBytes: 23 * 1_024 * 1_024 },
    ] })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
  });

  it.each([
    [[{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1_024 }]],
    [[{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1_024, contentSha256: "A".repeat(64) }]],
    [Array.from({ length: 2 }, (_, index) => ({ name: `observations-${index}.jsonl.gz`, contentType: "application/gzip", sizeBytes: 1_024, contentSha256: `${index}`.repeat(64) }))],
  ])("rejects malformed or repeated gzip diagnostic items %#", async (items) => {
    const repository = new EvidenceStoreFake();
    const storage = new Storage();
    const operation = evidence({ clock: { now: () => NOW }, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage });
    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111", workerId: "worker-1", jobRevision: 2,
      leaseToken: "lease-token", items: items as never,
    })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
    expect(repository.commands).toHaveLength(0);
  });

  it("fails closed when gzip storage support is unavailable", async () => {
    const repository = new EvidenceStoreFake();
    const legacyStorage = { evidence: async () => ({ objectKey: "unused", uploadUrl: "unused" }) };
    const operation = evidence({ clock: { now: () => NOW }, hasher: { sha256: async () => Uint8Array.from([1]) }, repository, storage: legacyStorage });
    await expect(operation({
      jobId: "11111111-1111-4111-8111-111111111111", workerId: "worker-1", jobRevision: 2,
      leaseToken: "lease-token",
      items: [{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1_024, contentSha256: "a".repeat(64) }],
    })).resolves.toEqual({ kind: "UNAVAILABLE" });
  });
});
