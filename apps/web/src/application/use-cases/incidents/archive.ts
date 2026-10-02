import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import {
    interactionData,
    PRIVATE_INDEX_BYTES as INDEX,
    PRIVATE_INDEX_ROWS as COUNT,
    type InteractionObservationV1
} from "@replay/shared-types";

// 압축 폭탄과 비공개 색인의 최대 자원 범위 고정
const COMPRESSED = 128 * 1024 * 1024;
const RAW = 512 * 1024 * 1024;
const LINE = 8 * 1024 * 1024;
const OBSERVATION_LINE = 65_536;
const TIMEOUT = 60_000;

// 원본과 실제 객체 해시에 결합된 비공개 수신 문맥 정의
interface IncidentArchiveContext {
    sourceSha256: string;
    artifactSha256: string;
    artifactSizeBytes: number;
    durationMs: number;
}

// 관측 원문을 보존하며 별도 색인으로 사용할 내부 묶음 정의
export interface IncidentArchive {
    schemaVersion: "private-incidents-v1";
    sourceSha256: string;
    artifactSha256: string;
    observations: readonly InteractionObservationV1[];
    // 생산자 예산으로 일부 관측만 기록했다는 요약 행의 표시
    truncated: boolean;
}

// 실제 압축 스트림을 검증하고 일반 상호작용 관측만 제한된 크기로 추출
// 재직렬화된 자료의 upstream 원본 압축 해시와 행 번호 및 행 해시는 생산자 주장으로만 보존
export async function incidentArchive(
    body: AsyncIterable<Uint8Array>, context: IncidentArchiveContext
): Promise<IncidentArchive> {
    // 검증 문맥의 수치와 원본 및 객체 해시 확인
    if (!/^[a-f0-9]{64}$/.test(context.sourceSha256)
        || !/^[a-f0-9]{64}$/.test(context.artifactSha256)
        || !Number.isSafeInteger(context.artifactSizeBytes)
        || context.artifactSizeBytes <= 0 || context.artifactSizeBytes > COMPRESSED
        || !Number.isSafeInteger(context.durationMs) || context.durationMs <= 0) {
        throw new Error("INCIDENT_ARCHIVE_CONTEXT_INVALID");
    }
    // 원문 전체 해시와 압축 및 비압축 바이트 수 초기화
    const hash = createHash("sha256");
    let compressed = 0, raw = 0, indexed = 0, lines = 0;
    let extension = false, summary = false, truncated = false;
    let pending = Buffer.alloc(0);
    const observations: InteractionObservationV1[] = [];
    const ids = new Set<string>();

    // 잘린 문자와 거대 행 및 다른 원본의 관측을 거부
    const entry = (bytes: Buffer) => {
        if (bytes.length > LINE) throw new Error("INCIDENT_ARCHIVE_LINE_LIMIT");
        let row: unknown;
        try {
            row = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
        } catch (error) {
            // 문자 부호화와 JSON 문법 오류를 산출물 형식 오류로 구분
            throw new Error("INCIDENT_ARCHIVE_ROW_INVALID", { cause: error });
        }
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
            throw new Error("INCIDENT_ARCHIVE_ROW_INVALID");
        }
        const value = row as Record<string, unknown>;
        // 첫 헤더를 현재 작업의 검증된 원본에 결합
        if (++lines === 1 && (value.kind !== "HEADER" || value.sourceSha256 !== context.sourceSha256)) {
            throw new Error("INCIDENT_ARCHIVE_HEADER_INVALID");
        }
        if (summary) throw new Error("INCIDENT_ARCHIVE_TRAILING_DATA");
        if (value.kind === "INTERACTION_OBSERVATION_HEADER") {
            if (extension || value.schemaVersion !== "interaction-observation-v1"
                || value.sourceSha256 !== context.sourceSha256) {
                throw new Error("INCIDENT_ARCHIVE_EXTENSION_INVALID");
            }
            extension = true;
        } else if (value.kind === "INTERACTION_OBSERVATION") {
            // 구조 수용은 사실 승인과 별개이며 측정 주장만 보존
            if (!extension || !interactionData(value) || value.sourceSha256 !== context.sourceSha256
                || value.endMs > context.durationMs || ids.has(value.observationId)) {
                throw new Error("INCIDENT_ARCHIVE_OBSERVATION_INVALID");
            }
            indexed += bytes.length;
            if (bytes.length > OBSERVATION_LINE || indexed > INDEX || observations.length >= COUNT) throw new Error("INCIDENT_ARCHIVE_INDEX_LIMIT");
            ids.add(value.observationId);
            observations.push(value);
        } else if (value.kind === "INTERACTION_OBSERVATION_SUMMARY") {
            if (!extension || value.sourceSha256 !== context.sourceSha256
                || value.observationCount !== observations.length
                || (value.truncated !== undefined && typeof value.truncated !== "boolean")) {
                throw new Error("INCIDENT_ARCHIVE_SUMMARY_INVALID");
            }
            summary = true;
            truncated = value.truncated === true;
        } else if (typeof value.kind === "string" && value.kind.startsWith("INTERACTION_OBSERVATION")) {
            throw new Error("INCIDENT_ARCHIVE_KIND_UNSUPPORTED");
        }
    };

    // 오류와 크기 초과 시 전체 파이프를 닫도록 한 처리 경계 구성
    await pipeline(
        Readable.from(body),
        new Transform({ transform(chunk: Buffer, _encoding, done) {
            compressed += chunk.length;
            if (compressed > context.artifactSizeBytes) {
                done(new Error("INCIDENT_ARCHIVE_COMPRESSED_LIMIT"));
                return;
            }
            hash.update(chunk);
            done(null, chunk);
        } }),
        createGunzip(),
        async (source) => {
            for await (const chunk of source) {
                raw += chunk.length;
                if (raw > RAW) throw new Error("INCIDENT_ARCHIVE_RAW_LIMIT");
                pending = Buffer.concat([pending, chunk]);
                let newline: number;
                while ((newline = pending.indexOf(10)) !== -1) {
                    entry(pending.subarray(0, newline));
                    pending = pending.subarray(newline + 1);
                }
                if (pending.length > LINE) throw new Error("INCIDENT_ARCHIVE_LINE_LIMIT");
            }
            if (pending.length) entry(pending);
        },
        { signal: AbortSignal.timeout(TIMEOUT) }
    ).catch((error: unknown) => {
        // 압축 형식 오류와 처리 시한 초과만 산출물 오류 부호로 바꾸고 저장소 오류는 그대로 전달
        if (error instanceof Error && typeof (error as Error & { code?: unknown }).code === "string"
            && (error as Error & { code: string }).code.startsWith("Z_")) {
            throw new Error("INCIDENT_ARCHIVE_COMPRESSION_INVALID", { cause: error });
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("INCIDENT_ARCHIVE_TIMEOUT", { cause: error });
        }
        throw error;
    });
    // 스트리밍 도중 바뀐 객체와 미완료 확장 산출물 차단
    if (!lines || compressed !== context.artifactSizeBytes || hash.digest("hex") !== context.artifactSha256
        || (extension && !summary)) throw new Error("INCIDENT_ARCHIVE_INCOMPLETE");
    return { schemaVersion: "private-incidents-v1", sourceSha256: context.sourceSha256,
        artifactSha256: context.artifactSha256, observations, truncated };
}
