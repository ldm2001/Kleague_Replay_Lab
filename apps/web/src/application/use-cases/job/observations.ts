import type { AnalysisPayload } from "../../ports/repositories/job-store";
import { ObjectLimitError, type CompletionStorage } from "../../ports/storage/upload-storage";
import type { EvidenceBodyStorage } from "../../ports/storage/evidence-storage";
import { PRIVATE_INDEX_BYTES, PRIVATE_INDEX_ROWS, type PrivateIndex } from "../../../shared/private-incidents";
import { incidentArchive } from "../incidents/archive";
import { incidentBatch } from "../incidents/batch";
import { bytesHex, type Context } from "./objects";

// 산출물 자체의 형식과 무결성 오류 부호
const ARTIFACT = new Set([
    "INCIDENT_ARCHIVE_ROW_INVALID", "INCIDENT_ARCHIVE_HEADER_INVALID", "INCIDENT_ARCHIVE_TRAILING_DATA",
    "INCIDENT_ARCHIVE_EXTENSION_INVALID", "INCIDENT_ARCHIVE_OBSERVATION_INVALID", "INCIDENT_ARCHIVE_SUMMARY_INVALID",
    "INCIDENT_ARCHIVE_KIND_UNSUPPORTED", "INCIDENT_ARCHIVE_COMPRESSED_LIMIT", "INCIDENT_ARCHIVE_COMPRESSION_INVALID",
    "INCIDENT_ARCHIVE_INCOMPLETE"
]);

// 관측이 가리킨 증거 파일의 불일치 오류 부호
const REFERENCE = new Set([
    "INCIDENT_EVIDENCE_REFERENCE_MISMATCH", "INCIDENT_EVIDENCE_PATH_MISMATCH", "INCIDENT_EVIDENCE_HASH_MISMATCH"
]);

// 공개 결과를 잃지 않고 색인만 생략하는 서버 자원 상한 오류 부호
const CAPACITY = new Set(["INCIDENT_ARCHIVE_LINE_LIMIT", "INCIDENT_ARCHIVE_RAW_LIMIT", "INCIDENT_ARCHIVE_INDEX_LIMIT"]);

// 비공개 색인 저장 명령 또는 기존 공개 거부 결과
export type Observations = PrivateIndex | Readonly<{ kind: "INVALID_RESULT"; reason: "ARTIFACT" | "REFERENCE" | "STORAGE" }>;

// 실제 저장소 호출 실패를 산출물 오류와 구분하는 내부 표시
class StorageFailure extends Error {}

// 검증 상한 초과는 그대로 두고 나머지 저장소 예외에 장애 표시
const storageCall = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof ObjectLimitError) throw error;
        throw new StorageFailure("STORAGE", { cause: error });
    }
};

// 본문 읽기 예외만 표시하고 파이프 중단 오류는 바꾸지 않도록 throw 없이 만든 반복자
const storageBody = (body: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> => ({
    [Symbol.asyncIterator]: () => {
        const iterator = body[Symbol.asyncIterator]();
        return {
            next: () => storageCall(() => iterator.next()),
            return: async () => (await iterator.return?.()) ?? { done: true, value: undefined }
        };
    }
});

// 비공개 산출물을 관측 색인으로 검증하고 저장 명령이나 거부 사유 반환
export const observations = async (
    analysis: AnalysisPayload, preflight: Context, jobId: string, jobRevision: number,
    privateStorage: EvidenceBodyStorage, storage: CompletionStorage
): Promise<Observations> => {
    const perception = analysis.perception!;
    const edition = preflight.ruleEdition;
    if (!preflight.durationMs) throw new Error("INCIDENT_DURATION_UNAVAILABLE");
    try {
        const content = await storageCall(() => privateStorage.body(perception.artifact.objectKey));
        const archive = await incidentArchive(storageBody(content.body), {
            sourceSha256: bytesHex(preflight.sourceSha256),
            artifactSha256: perception.artifact.contentSha256,
            artifactSizeBytes: perception.artifact.sizeBytes,
            durationMs: preflight.durationMs
        });
        const batch = await incidentBatch(archive, analysis, {
            analysisId: preflight.analysisId, jobId, jobRevision,
            ...(edition?.verificationStatus === "VERIFIED" && edition.competition && edition.season && edition.matchDate
                ? { match: { matchId: edition.matchId, competition: edition.competition, season: edition.season,
                    matchDate: edition.matchDate, ifabVersionId: `ifab-${edition.ifabEdition}`, verification: "VERIFIED" as const } }
                : {})
        }, { head: (key, limit) => storageCall(() => storage.head(key, limit)) });
        // 저장 경계와 같은 상한을 먼저 적용해 용량 초과가 결과 전체 실패로 번지지 않게 함
        if (batch.rows.length > PRIVATE_INDEX_ROWS || Buffer.byteLength(JSON.stringify(batch)) > PRIVATE_INDEX_BYTES) {
            return { status: "SKIPPED", reason: "PRIVATE_INDEX_CAPACITY" };
        }
        return { status: "INDEXED", batch };
    } catch (error) {
        if (error instanceof StorageFailure) return { kind: "INVALID_RESULT", reason: "STORAGE" };
        if (error instanceof ObjectLimitError) return { kind: "INVALID_RESULT", reason: "REFERENCE" };
        const code = error instanceof Error ? error.message : "";
        if (ARTIFACT.has(code)) return { kind: "INVALID_RESULT", reason: "ARTIFACT" };
        if (REFERENCE.has(code)) return { kind: "INVALID_RESULT", reason: "REFERENCE" };
        if (CAPACITY.has(code)) return { status: "SKIPPED", reason: "PRIVATE_INDEX_CAPACITY" };
        if (code === "INCIDENT_ARCHIVE_TIMEOUT") return { status: "SKIPPED", reason: "PRIVATE_INDEX_TIMEOUT" };
        // 문맥 오류와 승인 및 평가 예외는 서버 오류로 전달
        throw error;
    }
};
