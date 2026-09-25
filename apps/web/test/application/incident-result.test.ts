import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { result } from "../../src/application/use-cases/job/result";
import { interactionFixture } from "../fixtures/interaction";
import { perceptionPayload, PERCEPTION_ANALYSIS_ID, PERCEPTION_JOB_ID, PERCEPTION_SOURCE_SHA256,
    PERCEPTION_EVIDENCE_SHA256 } from "../fixtures/perception";

// 완료 제출과 실제 압축 객체를 같은 해시에 연결한 시험 환경 구성
const fixture = () => {
    const observation = interactionFixture();
    observation.sourceSha256 = PERCEPTION_SOURCE_SHA256;
    const raw = [
        { kind: "HEADER", sourceSha256: PERCEPTION_SOURCE_SHA256 },
        { kind: "INTERACTION_OBSERVATION_HEADER", sourceSha256: PERCEPTION_SOURCE_SHA256, schemaVersion: "interaction-observation-v1" },
        observation,
        { kind: "INTERACTION_OBSERVATION_SUMMARY", sourceSha256: PERCEPTION_SOURCE_SHA256, observationCount: 1 }
    ];
    const bytes = gzipSync(raw.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const initial = perceptionPayload();
    const payload = { ...initial, perception: { ...initial.perception!,
        artifact: { ...initial.perception!.artifact, sizeBytes: bytes.length, contentSha256: digest,
            objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${digest}.jsonl.gz` } } };
    const repository = {
        preflight: vi.fn(async () => ({ kind: "AUTHORIZED" as const, analysisId: PERCEPTION_ANALYSIS_ID,
            sourceSha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"), analysisSourceSha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
            expiresAt: "2031-01-01T00:00:00.000Z", durationMs: 5000, ruleEdition: null })),
        result: vi.fn(async (_command: import("../../src/application/ports/repositories/job-store").JobResultCommand) => ({ kind: "ACCEPTED" as const }))
    };
    const storage = { head: vi.fn(async (key: string) => ({ sizeBytes: key.endsWith(".gz") ? bytes.length : 12,
        contentSha256: Buffer.from(key.endsWith(".gz") ? digest : PERCEPTION_EVIDENCE_SHA256, "hex") })) };
    const privateStorage = { body: vi.fn(async () => ({ body: (async function* () { yield bytes; })() })) };
    const dependencies = { repository, storage, privateStorage,
        clock: { now: () => new Date("2030-01-01T00:00:00Z") }, hasher: { sha256: async () => new Uint8Array(32) } };
    const input = { jobId: PERCEPTION_JOB_ID, workerId: "worker", jobRevision: 2, leaseToken: "lease", payload };
    return { dependencies, input, repository, privateStorage };
};

describe("incident indexing in result submission", () => {
    it("passes verified private observations into the existing result transaction", async () => {
        const f = fixture();
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "ACCEPTED" });
        const command = f.repository.result.mock.calls[0]![0] as any;
        expect(command.privateIncidents.rows).toHaveLength(1);
        expect(command.privateIncidents.rows[0].record).toBeNull();
        expect(command.privateIncidents.rows[0].admittedFactIds).toEqual([]);
    });

    it("never persists a stream that changed after object verification", async () => {
        const f = fixture();
        f.privateStorage.body.mockResolvedValue({ body: (async function* () { yield Buffer.from("bad"); })() });
        await expect(result(f.dependencies)(f.input)).rejects.toThrow();
        expect(f.repository.result).not.toHaveBeenCalled();
    });
});
