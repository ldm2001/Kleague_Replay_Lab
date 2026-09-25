import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { incidentArchive } from "../apps/web/src/application/use-cases/incidents/archive";
import { incidentRecord } from "../apps/web/src/application/use-cases/incidents/record";

// 파일 전체를 메모리에 올리지 않고 실제 내용 해시 계산
async function digest(path: string) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}

// 기존 실영상 산출물 재처리이며 모델 재추론과 사실 승인 제외
const [sourceInput, artifactInput] = process.argv.slice(2);
if (!sourceInput || !artifactInput) throw new Error("Usage: audit:incidents -- SOURCE_VIDEO ARTIFACT_GZIP");
const source = await realpath(sourceInput);
const artifact = await realpath(artifactInput);
const root = await realpath(resolve(dirname(artifact), ".."));
const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-of", "json", source],
    { encoding: "utf8", timeout: 30_000 }));
const durationMs = Math.round(Number(metadata.format.duration) * 1000);
const sourceSha256 = await digest(source);
const artifactSha256 = await digest(artifact);
const archive = await incidentArchive(createReadStream(artifact), {
    sourceSha256, artifactSha256, artifactSizeBytes: (await stat(artifact)).size, durationMs
});
const candidates = new Set<string>();
const media = new Map<string, string | null>();
const reasons: Record<string, number> = {};
let measured = 0, unknown = 0, generated = 0, mediaVerifiedObservations = 0;
for (const observation of archive.observations) {
    candidates.add(observation.candidateId);
    for (const measurement of Object.values(observation.measurements)) {
        if (measurement.state === "MEASURED") measured += 1;
        else unknown += 1;
    }
    let verified = observation.evidence.length > 0;
    for (const evidence of observation.evidence) {
        if (!media.has(evidence.path)) {
            // 산출물 루트 밖으로 향하는 경로와 심볼릭 링크는 읽지 않음
            try {
                const path = await realpath(resolve(root, evidence.path));
                if (!path.startsWith(root + sep) || (await stat(path)).size > 50 * 1024 * 1024) throw new Error("OUTSIDE_MEDIA_ROOT");
                media.set(evidence.path, await digest(path));
            } catch {
                media.set(evidence.path, null);
            }
        }
        if (media.get(evidence.path) !== evidence.contentSha256) verified = false;
    }
    if (verified) mediaVerifiedObservations += 1;
    const converted = incidentRecord(observation);
    if (converted.kind === "GENERATED" && verified) generated += 1;
    else for (const reason of converted.kind === "UNRESOLVED" ? converted.reasons : ["MEDIA_UNVERIFIED"]) {
        reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
}
// 계산 가능한 측정과 실제 유형 판별 미지원 및 의미 검증 미완료를 분리해 보고
console.log(JSON.stringify({ schemaVersion: "incident-audit-v1", sourceSha256, artifactSha256,
    observations: archive.observations.length, candidates: candidates.size, measured, unknown,
    mediaVerifiedObservations, generated, reasons, admittedFacts: 0,
    upstreamProvenance: "DECLARED_NOT_VERIFIED", semanticValidation: "NOT_ESTABLISHED" }, null, 2));
