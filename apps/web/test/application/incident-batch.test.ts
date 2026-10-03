import { describe, expect, it, vi } from "vitest";
import { interactionFixture } from "../fixtures/interaction";
import { incidentBatch } from "../../src/application/use-cases/incidents/batch";
import { incidentEvaluation } from "../../src/application/use-cases/incidents/admission";
import { interactionData } from "../../src/shared/interaction";
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
        artifactSha256: "b".repeat(64), observations: [observation], truncated: false };
    const storage = { head: vi.fn(async () => ({ sizeBytes: 4, contentSha256: Buffer.from("d".repeat(64), "hex") })) };
    return { observation, context, payload, archive, storage };
};

// 관측 시각과 제출 시각을 별도로 정한 프레임 증거 생성
const frame = (startMs = 100, endMs = startMs) => {
    const f = fixture();
    f.observation.evidence = [{
        ...f.observation.evidence[0]!, kind: "FRAME", path: "frames/frame.jpg",
        startMs, endMs, coversMeasurementWindow: false
    }];
    f.payload = { ...f.payload, evidence: [{
        ...f.payload.evidence![0]!, kind: "FRAME",
        objectKey: `evidence/analysis/job/1/${"d".repeat(64)}/frame.jpg`, startMs, endMs
    }] };
    return f;
};

describe("private incident batch", () => {
    it("preserves a verified FRAME point without admitting facts", async () => {
        const f = frame();
        const batch = await incidentBatch(f.archive, f.payload, f.context, f.storage);
        expect(batch.rows[0]!.observation.evidence[0]).toMatchObject({
            kind: "FRAME", timestampMs: 100, startMs: 100, endMs: 100
        });
        expect(batch.rows[0]!.record).toBeNull();
        expect(f.storage.head).toHaveBeenCalledOnce();
    });

    it.each([[0, 0], [101, 300], [0, 300]])(
        "rejects a newly submitted FRAME interval [%i %i] before storage access",
        async (startMs, endMs) => {
            const f = frame(startMs, endMs);
            if (startMs === 0 && endMs === 300) expect(interactionData(f.observation)).toBe(true);
            await expect(incidentBatch(f.archive, f.payload, f.context, f.storage))
                .rejects.toThrow("INCIDENT_EVIDENCE_REFERENCE_MISMATCH");
            expect(f.storage.head).not.toHaveBeenCalled();
        }
    );

    it("rejects a FRAME timestamp inside a wider reference that differs from the submitted point", async () => {
        const f = frame(0, 300);
        f.payload = { ...f.payload, evidence: f.payload.evidence!.map((entry) => ({
            ...entry, startMs: 200, endMs: 200
        })) };
        expect(interactionData(f.observation)).toBe(true);
        await expect(incidentBatch(f.archive, f.payload, f.context, f.storage))
            .rejects.toThrow("INCIDENT_EVIDENCE_REFERENCE_MISMATCH");
        expect(f.storage.head).not.toHaveBeenCalled();
    });

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
        const row = batch.rows[0]!;
        expect(row.record!.match.verification).toBe("VERIFIED");
        expect(row.reasons).toEqual(["UPSTREAM_PROVENANCE_UNVERIFIED"]);
        // 승인과 평가는 배치에 싣지 않고 저장 경계의 단일 계산으로만 생성
        expect(row).not.toHaveProperty("admittedFactIds");
        expect(row).not.toHaveProperty("evaluations");
        const evaluated = incidentEvaluation(row.record!, new Map(row.record!.evidence.map((item) => [item.id, item.contentSha256])));
        expect([...evaluated.admission.factIds]).toEqual([]);
        expect(evaluated.evaluations[0]!.conclusions.offence.status).toBe("UNDETERMINED");
        expect(evaluated.evaluations[0]!.conclusions.disciplinary.status).toBe("UNSUPPORTED");
    });

    it("records a missing rule context without choosing a default edition", async () => {
        const f = fixture();
        const provenance = { state: "HYPOTHESIS" as const, reasons: ["METHOD_UNVALIDATED"],
            method: { id: "fixture", version: "1" }, observationIds: [f.observation.observationId] };
        f.observation.actionType = { ...provenance, value: "HOLDING_MOTION" };
        f.observation.direction = { ...provenance, value: "A_TO_B" };
        const batch = await incidentBatch(f.archive, f.payload, f.context, f.storage);
        expect(batch.rows[0]!.reasons).toEqual(["RULE_CONTEXT_UNAVAILABLE", "UPSTREAM_PROVENANCE_UNVERIFIED"]);
    });

    it("preserves unknown type and known measurements after actual media verification", async () => {
        const f = fixture();
        const batch = await incidentBatch(f.archive, f.payload, f.context, f.storage);
        expect(batch.rows[0]!.record).toBeNull();
        expect(batch.rows[0]!.observation.measurements.centerDistance!.state).toBe("MEASURED");
        expect(batch.rows[0]).not.toHaveProperty("admittedFactIds");
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
