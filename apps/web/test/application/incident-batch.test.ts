import { describe, expect, it, vi } from "vitest";
import { interactionFixture } from "../fixtures/interaction";
import { incidentBatch } from "../../src/application/use-cases/incidents/batch";
import type { AnalysisPayload } from "../../src/application/ports/repositories/job-store";

// 실제 관측과 해당 작업의 증거 객체 참조를 함께 구성
const fixture = () => {
    const observation = interactionFixture();
    observation.evidence = [{ evidenceIndex: 0, kind: "CLIP", path: "clips/clip.mp4", timestampMs: 100,
        startMs: 0, endMs: 100, contentSha256: "d".repeat(64), coversMeasurementWindow: true }];
    const context = { analysisId: "analysis", jobId: "job", jobRevision: 1 };
    const payload: AnalysisPayload = { kind: "ANALYZED", pipelineVersion: "video-local-observers-av-v1",
        limitations: [], shots: [], candidates: [], evidence: [{ candidateIndex: 0, kind: "CLIP",
            objectKey: `evidence/analysis/job/1/${"d".repeat(64)}/clip.mp4`, contentSha256: "d".repeat(64),
            startMs: 0, endMs: 100, width: null, height: null }] };
    const archive = { schemaVersion: "private-incidents-v1" as const, sourceSha256: "a".repeat(64),
        artifactSha256: "b".repeat(64), observations: [observation] };
    const storage = { head: vi.fn(async () => ({ sizeBytes: 4, contentSha256: Buffer.from("d".repeat(64), "hex") })) };
    return { observation, context, payload, archive, storage };
};

describe("private incident batch", () => {
    it("evaluates a typed record only with server-supplied rule context while facts stay unapproved", async () => {
        const f = fixture();
        const provenance = { state: "HYPOTHESIS" as const, reasons: ["METHOD_UNVALIDATED"],
            method: { id: "fixture", version: "1" }, observationIds: [f.observation.observationId] };
        f.observation.actionType = { ...provenance, value: "HOLDING_MOTION" };
        f.observation.direction = { ...provenance, value: "A_TO_B" };
        const batch = await incidentBatch(f.archive, f.payload, { ...f.context, match: {
            matchId: "fixture-match", competition: "fixture", season: "fixture", matchDate: "2026-01-01",
            ifabVersionId: "ifab-2025-26", verification: "VERIFIED"
        } }, f.storage);
        expect(batch.rows[0]!.record!.match.verification).toBe("VERIFIED");
        expect(batch.rows[0]!.admittedFactIds).toEqual([]);
        expect(batch.rows[0]!.evaluations[0]!.conclusions.offence.status).toBe("UNDETERMINED");
        expect(batch.rows[0]!.evaluations[0]!.conclusions.disciplinary.status).toBe("UNSUPPORTED");
    });

    it("preserves unknown type and known measurements after actual media verification", async () => {
        const f = fixture();
        const batch = await incidentBatch(f.archive, f.payload, f.context, f.storage);
        expect(batch.rows[0]!.record).toBeNull();
        expect(batch.rows[0]!.observation.measurements.centerDistance!.state).toBe("MEASURED");
        expect(batch.rows[0]!.admittedFactIds).toEqual([]);
        expect(f.storage.head).toHaveBeenCalledOnce();
    });

    it.each(["hash", "path", "interval", "missing"])("rejects media %s mismatch", async (kind) => {
        const f = fixture();
        if (kind === "hash") f.storage.head.mockResolvedValue({ sizeBytes: 4, contentSha256: Buffer.from("e".repeat(64), "hex") });
        if (kind === "path") f.context.jobRevision = 2;
        if (kind === "interval") f.payload = { ...f.payload, evidence: f.payload.evidence!.map((item) => ({ ...item, endMs: 101 })) };
        if (kind === "missing") f.payload = { ...f.payload, evidence: [] };
        await expect(incidentBatch(f.archive, f.payload, f.context, f.storage)).rejects.toThrow(/INCIDENT_EVIDENCE/);
    });
});
