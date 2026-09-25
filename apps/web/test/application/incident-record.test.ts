import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { python } from "../../../../scripts/python.mjs";
import { incidentRecord } from "../../src/application/use-cases/incidents/record";
import { incidentRecordData } from "../../src/shared/incident-schema";
import { interactionData, incidentLineage } from "../../src/shared/interaction";

// 실제 Worker 생산자의 측정 관측 읽음
const raw = JSON.parse(execFileSync(python(), ["-c", `
import json
from fixtures.interaction import frame
from replay_video.domain.interactions import InteractionObservations
engine = InteractionObservations('a'*64)
engine.update(frame(), 's1')
row = engine.update(frame(200, shift=10), 's1')[0]
row['upstream'] = {'artifactSha256':'b'*64,'lineNumber':3,'rowSha256':'c'*64}
print(json.dumps(row))
`], {
    env: {
        ...process.env,
        PYTHONPATH: ["apps/video-worker/src", "apps/video-worker/tests"]
            .map((path) => resolve(path)).join(delimiter)
    },
    encoding: "utf8"
}));

// 독립 가설과 실제 영상 참조가 있는 시험 관측 생성
function fixture() {
    const row = structuredClone(raw);
    for (const [key, value] of [["actionType", "HOLDING_MOTION"], ["direction", "A_TO_B"]]) {
        row[key!] = {
            state: "HYPOTHESIS",
            value,
            reasons: ["METHOD_UNVALIDATED"],
            method: { id: `independent-${key}`, version: "1" },
            observationIds: [row.observationId]
        };
    }
    row.evidence = [{
        evidenceIndex: 7,
        kind: "CLIP",
        path: "evidence/clip.mp4",
        timestampMs: 200,
        startMs: 0,
        endMs: 300,
        contentSha256: "d".repeat(64),
        coversMeasurementWindow: true
    }];
    expect(interactionData(row)).toBe(true);
    return row;
}

// 생성 결과의 자료형과 출처 연결 확인
function generated(row = fixture()) {
    const result = incidentRecord(row);
    expect(result.kind).toBe("GENERATED");
    if (result.kind !== "GENERATED") throw new Error("Expected generated record");
    expect(incidentRecordData(result.record)).toBe(true);
    expect(incidentLineage(row, result.record, result.link.actionId)).toEqual(result.link);
    return result;
}

describe("interaction incident adapter", () => {
    it.each(["actionType", "direction"])("preserves unknown %s without inference", (key) => {
        const row = fixture();
        row[key] = { state: "UNKNOWN", value: null, reasons: ["NO_HYPOTHESIS"] };
        expect(incidentRecord(row)).toMatchObject({ kind: "UNRESOLVED", observation: row });
    });

    it("leaves unsupported action hypotheses unresolved", () => {
        const row = fixture();
        row.actionType.value = "PUSHING_MOTION";
        expect(incidentRecord(row)).toMatchObject({ kind: "UNRESOLVED", observation: row });
    });

    it("requires media and never substitutes artifact hashes", () => {
        const row = fixture();
        row.evidence = [];
        expect(incidentRecord(row).kind).toBe("UNRESOLVED");
    });

    it.each([null, {}, { ...raw, participantB: { ...raw.participantB, segmentId: "s2" } }])(
        "rejects malformed or cross-segment input",
        (row) => expect(() => incidentRecord(row)).toThrow(/interaction/i)
    );

    it("preserves neutral actors and independently supplied reverse direction", () => {
        const row = fixture();
        row.direction.value = "B_TO_A";
        const { record } = generated(row);
        const action = record.actions[0]!;
        expect(record.actors[0]!.tracklets[0]!.trackId).toBe(row.participantA.trackId);
        expect(action.actorId).toBe(record.actors[1]!.id);
        expect(action.targetActorId).toBe(record.actors[0]!.id);
    });

    it("retains measured values with covering media without inventing approved facts", () => {
        const row = fixture();
        const before = JSON.stringify(row);
        const { record, observation } = generated(row);
        expect(JSON.stringify(row)).toBe(before);
        expect(observation).toEqual(row);
        expect(record.match).toEqual({
            matchId: null, competition: null, season: null, matchDate: null,
            ifabVersionId: null, verification: "UNVERIFIED"
        });
        expect(record.links).toEqual([]);
        expect(record.refereeDecisions).toEqual([]);
        expect(record.segments[0]).toMatchObject({
            startMs: 0, endMs: 300, playbackSpeed: "UNKNOWN", replayState: "UNKNOWN"
        });
        const action = record.actions[0]!;
        for (const claim of [...Object.values(action.context), ...Object.values(action.observations)]) {
            expect(claim.state).toBe("UNKNOWN");
            expect(claim.reasons.length).toBeGreaterThan(0);
        }
        for (const actor of record.actors) {
            expect(actor.teamId).toBeNull();
            expect(actor.teamAssignment.state).toBe("UNKNOWN");
        }
        const measured = row.measurements as Record<string, { value: number | null; state: string }>;
        for (const [name, measure] of Object.entries(measured)) {
            const typed = action.measurements.find((m) => m.id.endsWith(`:${name}`))!;
            expect(typed).toBeDefined();
            expect(typed.value).toBe(measure.value);
            expect(typed.origin).toBe("IMAGE_MEASUREMENT");
            expect(typed.method.id).toBe(row.method.id);
            if (measure.state === "MEASURED") {
                expect(typed.state).toBe("KNOWN");
                expect(typed.evidenceIds).toEqual([record.evidence[0]!.id]);
            }
        }
        expect(record.evidence[0]!.contentSha256).toBe("d".repeat(64));
    });

    it("keeps temporal measurements unknown when only a point frame is backed", () => {
        const row = fixture();
        row.evidence[0] = {
            ...row.evidence[0], kind: "FRAME", path: "evidence/frame.jpg",
            startMs: 200, endMs: 200, coversMeasurementWindow: false
        };
        const { record, observation } = generated(row);
        const values = record.actions[0]!.measurements;
        expect(values.find((m) => m.id.endsWith(":centerDistance"))!.state).toBe("KNOWN");
        expect(values.find((m) => m.id.endsWith(":participantASpeed"))).toMatchObject({
            state: "UNKNOWN", value: null, evidenceIds: []
        });
        expect(observation.measurements.participantASpeed!.state).toBe("MEASURED");
    });

    it("maps frame intervals to point evidence without treating them as temporal proof", () => {
        const row = fixture();
        row.evidence[0] = {
            ...row.evidence[0], kind: "FRAME", path: "evidence/frame.jpg",
            coversMeasurementWindow: false
        };
        const { record } = generated(row);
        expect(record.evidence[0]).toMatchObject({ kind: "FRAME", startMs: 200, endMs: 200 });
        expect(record.segments[0]).toMatchObject({ startMs: row.startMs, endMs: row.endMs });
        const values = record.actions[0]!.measurements;
        expect(values.find((m) => m.id.endsWith(":centerDistance"))!.state).toBe("KNOWN");
        expect(values.find((m) => m.id.endsWith(":participantASpeed"))).toMatchObject({
            state: "UNKNOWN", value: null, evidenceIds: []
        });
    });

    it("only backs quantities whose own windows fit a partial clip", () => {
        const row = fixture();
        row.evidence[0].startMs = 100;
        row.evidence[0].coversMeasurementWindow = false;
        const { record } = generated(row);
        const values = record.actions[0]!.measurements;
        expect(values.find((m) => m.id.endsWith(":centerDistance"))!.state).toBe("KNOWN");
        expect(values.find((m) => m.id.endsWith(":participantASpeed"))).toMatchObject({
            state: "UNKNOWN", value: null, evidenceIds: [],
            reasons: ["MEASUREMENT_WINDOW_EVIDENCE_MISSING"]
        });
    });

    it("does not invent positive segment duration from a single frame", () => {
        const row = fixture();
        row.startMs = row.endMs;
        for (const measure of Object.values(row.measurements) as { startMs: number }[]) {
            measure.startMs = row.endMs;
        }
        row.evidence[0] = {
            ...row.evidence[0], kind: "FRAME", path: "evidence/frame.jpg",
            startMs: 200, endMs: 200, coversMeasurementWindow: false
        };
        expect(interactionData(row)).toBe(true);
        expect(incidentRecord(row)).toMatchObject({
            kind: "UNRESOLVED", reasons: ["SEGMENT_SPAN_UNKNOWN"]
        });
    });

    it("preserves missing measurements as unknown", () => {
        const row = fixture();
        row.measurements.aLeftElbowAngle = {
            ...row.measurements.aLeftElbowAngle, state: "UNKNOWN", value: null,
            reasons: ["KEYPOINT_MISSING"]
        };
        const { record } = generated(row);
        expect(record.actions[0]!.measurements.find((m) => m.id.endsWith(":aLeftElbowAngle")))
            .toMatchObject({ state: "UNKNOWN", value: null, reasons: ["KEYPOINT_MISSING"] });
    });

    it("uses deterministic source candidate and observation bound identifiers", () => {
        const row = fixture();
        const first = generated(row);
        expect(generated(structuredClone(row))).toEqual(first);
        for (const field of ["sourceSha256", "candidateId", "observationId"]) {
            const next = fixture();
            next[field] = field === "sourceSha256" ? "e".repeat(64)
                : `${field === "candidateId" ? "candidate" : "observation"}-${"e".repeat(64)}`;
            if (field === "observationId") {
                next.actionType.observationIds = [next.observationId];
                next.direction.observationIds = [next.observationId];
            }
            const later = generated(next);
            expect(later.record.incidentId).not.toBe(first.record.incidentId);
            expect(later.link.actionId).not.toBe(first.link.actionId);
        }
    });
});
