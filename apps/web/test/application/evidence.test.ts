import { describe, expect, it } from "vitest";
import {
  evidence,
  type Clock,
  type EvidenceAccess,
  type EvidenceAccessCommand,
  type EvidenceAccessRepo,
  type EvidenceGrant,
  type EvidenceGrantInput,
  type EvidenceStorage,
} from "@replay/application";

const NOW = new Date("2026-08-31T00:00:00.000Z");

class AccessRepo implements EvidenceAccessRepo {
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

  async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
    this.inputs.push(input);
    return {
      objectKey: `evidence/${input.analysisId}/${input.jobId}/${input.name}`,
      uploadUrl: `http://storage.test/${input.name}`,
    };
  }
}

describe("evidence grants", () => {
  it("authorizes a lease and grants only bounded evidence files", async () => {
    const repository = new AccessRepo();
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
    const repository = new AccessRepo();
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
});
