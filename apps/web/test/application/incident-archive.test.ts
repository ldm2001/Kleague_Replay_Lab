import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { python } from "../../../../scripts/python.mjs";
import { incidentArchive } from "../../src/application/use-cases/incidents/archive";

// 실제 파이썬 생산자로 구조가 유효한 관측 생성
const observation = () => JSON.parse(execFileSync(python(), ["-c", `
import json
from fixtures.interaction import frame
from replay_video.domain.interactions import InteractionObservations
row = InteractionObservations('a'*64).update(frame(), 's1')[0]
row['upstream'] = {'artifactSha256':'b'*64,'lineNumber':2,'rowSha256':'c'*64}
print(json.dumps(row))
`], {
    env: { ...process.env, PYTHONPATH: ["apps/video-worker/src", "apps/video-worker/tests"].map((path) => resolve(path)).join(delimiter) },
    encoding: "utf8"
}));

// 비공개 산출물의 실제 압축 바이트와 검증 문맥 구성
const fixture = (rows: unknown[]) => {
    const body = gzipSync(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    return {
        body,
        context: {
            sourceSha256: "a".repeat(64),
            artifactSha256: createHash("sha256").update(body).digest("hex"),
            artifactSizeBytes: body.length,
            durationMs: 1000
        }
    };
};

// 임의 바이트 경계의 실제 스트림 입력 구성
async function* chunks(body: Buffer) {
    for (let index = 0; index < body.length; index += 31) yield body.subarray(index, index + 31);
}

describe("private incident archive", () => {
    it.each(["truncated", "utf8", "line"])("rejects %s archive content", async (kind) => {
        const data = fixture([{ kind: "HEADER", sourceSha256: "a".repeat(64) }]);
        if (kind === "truncated") data.body = data.body.subarray(0, data.body.length - 4);
        if (kind === "utf8") data.body = gzipSync(Buffer.from([0xff, 0x0a]));
        if (kind === "line") data.body = gzipSync(JSON.stringify({ kind: "HEADER", padding: "x".repeat(8 * 1024 * 1024) }));
        data.context.artifactSizeBytes = data.body.length;
        data.context.artifactSha256 = createHash("sha256").update(data.body).digest("hex");
        await expect(incidentArchive(chunks(data.body), data.context)).rejects.toThrow();
    });

    it("closes the input stream after compressed size rejection", async () => {
        const data = fixture([{ kind: "HEADER", sourceSha256: "a".repeat(64) }]);
        let closed = false;
        async function* stream() {
            try { yield data.body; } finally { closed = true; }
        }
        await expect(incidentArchive(stream(), { ...data.context, artifactSizeBytes: 1 })).rejects.toThrow();
        expect(closed).toBe(true);
    });

    it("retains actual measurements without inventing action facts", async () => {
        const row = observation();
        const data = fixture([
            { kind: "HEADER", sourceSha256: row.sourceSha256 },
            { kind: "INTERACTION_OBSERVATION_HEADER", schemaVersion: "interaction-observation-v1", sourceSha256: row.sourceSha256 },
            row,
            { kind: "INTERACTION_OBSERVATION_SUMMARY", sourceSha256: row.sourceSha256, observationCount: 1 }
        ]);
        const result = await incidentArchive(chunks(data.body), data.context);
        expect(result.observations).toEqual([row]);
        expect(result.observations[0]!.actionType.state).toBe("UNKNOWN");
    });

    it("preserves legacy archives without an interaction extension", async () => {
        const data = fixture([{ kind: "HEADER", sourceSha256: "a".repeat(64) }]);
        expect((await incidentArchive(chunks(data.body), data.context)).observations).toEqual([]);
    });

    it.each(["hash", "source", "summary", "duplicate", "schema"])("rejects invalid %s", async (kind) => {
        const row = observation();
        const rows: any[] = [
            { kind: "HEADER", sourceSha256: row.sourceSha256 },
            { kind: "INTERACTION_OBSERVATION_HEADER", schemaVersion: "interaction-observation-v1", sourceSha256: row.sourceSha256 },
            row,
            { kind: "INTERACTION_OBSERVATION_SUMMARY", sourceSha256: row.sourceSha256, observationCount: 1 }
        ];
        if (kind === "source") row.sourceSha256 = "d".repeat(64);
        if (kind === "summary") rows.pop();
        if (kind === "duplicate") rows.splice(3, 0, row);
        if (kind === "schema") rows[1].schemaVersion = "unknown";
        const data = fixture(rows);
        if (kind === "hash") data.context.artifactSha256 = "e".repeat(64);
        await expect(incidentArchive(chunks(data.body), data.context)).rejects.toThrow();
    });
});
