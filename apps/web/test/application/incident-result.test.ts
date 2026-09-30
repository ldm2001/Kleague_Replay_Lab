import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { result } from "../../src/application/use-cases/job/result";
import type { JobResultCommand } from "../../src/application/ports/repositories/job-store";
import type { InteractionObservationV1 } from "../../src/shared/interaction";
import { interactionFixture } from "../fixtures/interaction";
import { perceptionPayload, PERCEPTION_ANALYSIS_ID, PERCEPTION_JOB_ID, PERCEPTION_SOURCE_SHA256,
    PERCEPTION_EVIDENCE_SHA256 } from "../fixtures/perception";

// 완료 제출과 실제 압축 객체를 같은 해시에 연결한 시험 환경 구성
const fixture = (options: { edit?: (observation: InteractionObservationV1) => void; pad?: number;
    summary?: Record<string, unknown>; durationMs?: number | null } = {}) => {
    const observation = interactionFixture();
    observation.sourceSha256 = PERCEPTION_SOURCE_SHA256;
    options.edit?.(observation);
    const raw = [
        { kind: "HEADER", sourceSha256: PERCEPTION_SOURCE_SHA256 },
        { kind: "INTERACTION_OBSERVATION_HEADER", sourceSha256: PERCEPTION_SOURCE_SHA256, schemaVersion: "interaction-observation-v1" },
        observation,
        { kind: "INTERACTION_OBSERVATION_SUMMARY", sourceSha256: PERCEPTION_SOURCE_SHA256, observationCount: 1, ...options.summary }
    ];
    const lines = raw.map((row) => JSON.stringify(row));
    lines[2] += " ".repeat(options.pad ?? 0);
    const bytes = gzipSync(lines.join("\n") + "\n");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const initial = perceptionPayload();
    const payload = { ...initial, perception: { ...initial.perception!,
        artifact: { ...initial.perception!.artifact, sizeBytes: bytes.length, contentSha256: digest,
            objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${digest}.jsonl.gz` } } };
    const repository = {
        preflight: vi.fn(async () => ({ kind: "AUTHORIZED" as const, analysisId: PERCEPTION_ANALYSIS_ID,
            sourceSha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"), analysisSourceSha256: Buffer.from(PERCEPTION_SOURCE_SHA256, "hex"),
            expiresAt: "2031-01-01T00:00:00.000Z", durationMs: options.durationMs === undefined ? 5000 : options.durationMs,
            ruleEdition: null })),
        result: vi.fn(async (_command: JobResultCommand) => ({ kind: "ACCEPTED" as const }))
    };
    const storage = { head: vi.fn(async (key: string) => ({ sizeBytes: key.endsWith(".gz") ? bytes.length : 12,
        contentSha256: Buffer.from(key.endsWith(".gz") ? digest : PERCEPTION_EVIDENCE_SHA256, "hex") })) };
    const privateStorage = { body: vi.fn(async (): Promise<{ body: AsyncIterable<Uint8Array> }> =>
        ({ body: (async function* () { yield bytes; })() })) };
    const dependencies = { repository, storage, privateStorage,
        clock: { now: () => new Date("2030-01-01T00:00:00Z") }, hasher: { sha256: async () => new Uint8Array(32) } };
    const input = { jobId: PERCEPTION_JOB_ID, workerId: "worker", jobRevision: 2, leaseToken: "lease", payload };
    return { dependencies, input, repository, privateStorage };
};

// 첫 읽기에서 저장소 연결 실패를 흉내 내는 본문
const broken: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error("socket reset"); } })
};

describe("incident indexing in result submission", () => {
    it("passes verified private observations into the existing result transaction", async () => {
        const f = fixture();
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "ACCEPTED" });
        const command = f.repository.result.mock.calls[0]![0] as any;
        expect(command.privateIndex.status).toBe("INDEXED");
        expect(command.privateIndex.batch.truncated).toBe(false);
        expect(command.privateIndex.batch.rows).toHaveLength(1);
        expect(command.privateIndex.batch.rows[0].record).toBeNull();
        expect(command.privateIndex.batch.rows[0]).not.toHaveProperty("admittedFactIds");
    });

    it("rejects a stream that changed after object verification as an artifact fault", async () => {
        const f = fixture();
        f.privateStorage.body.mockResolvedValue({ body: (async function* () { yield Buffer.from("bad"); })() });
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "INVALID_RESULT", reason: "ARTIFACT" });
        expect(f.repository.result).not.toHaveBeenCalled();
    });

    it.each(["open", "read"])("reports a storage %s failure separately from artifact faults", async (kind) => {
        const f = fixture();
        const diagnostic = vi.fn();
        if (kind === "open") f.privateStorage.body.mockRejectedValue(new Error("unavailable"));
        else f.privateStorage.body.mockResolvedValue({ body: broken });
        expect(await result({ ...f.dependencies, diagnostic })(f.input)).toEqual({ kind: "INVALID_RESULT", reason: "STORAGE" });
        expect(diagnostic).toHaveBeenCalledWith({ stage: "OBSERVATIONS", jobId: PERCEPTION_JOB_ID.toLowerCase(), jobRevision: 2 });
        expect(f.repository.result).not.toHaveBeenCalled();
    });

    it("rejects an observation whose evidence differs from the submitted evidence as a reference fault", async () => {
        const f = fixture({ edit: (observation) => {
            observation.evidence = [{ evidenceIndex: 0, kind: "FRAME", path: "frames/candidate-0001.jpg",
                timestampMs: observation.endMs, startMs: observation.endMs, endMs: observation.endMs,
                contentSha256: "f".repeat(64), coversMeasurementWindow: false }];
        } });
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "INVALID_RESULT", reason: "REFERENCE" });
        expect(f.repository.result).not.toHaveBeenCalled();
    });

    it("keeps the public result and records a skipped index when the private index exceeds capacity", async () => {
        const f = fixture({ pad: 70_000 });
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "ACCEPTED" });
        const command = f.repository.result.mock.calls[0]![0] as any;
        expect(command.privateIndex).toEqual({ status: "SKIPPED", reason: "PRIVATE_INDEX_CAPACITY" });
        expect(command.perceptionVerification).toBeDefined();
    });

    it("carries a producer truncation marker into the private index", async () => {
        const f = fixture({ summary: { truncated: true, omittedObservationCount: 3 } });
        expect(await result(f.dependencies)(f.input)).toEqual({ kind: "ACCEPTED" });
        const command = f.repository.result.mock.calls[0]![0] as any;
        expect(command.privateIndex.status).toBe("INDEXED");
        expect(command.privateIndex.batch.truncated).toBe(true);
    });

    it("treats a missing server duration as a server fault instead of a client rejection", async () => {
        const f = fixture({ durationMs: null });
        await expect(result(f.dependencies)(f.input)).rejects.toThrow("INCIDENT_DURATION_UNAVAILABLE");
        expect(f.repository.result).not.toHaveBeenCalled();
    });
});
