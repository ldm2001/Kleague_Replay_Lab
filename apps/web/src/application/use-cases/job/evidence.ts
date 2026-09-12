import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type { EvidenceAccess, EvidenceStore } from "../../ports/repositories/evidence-store";
import type { EvidenceStorage } from "../../ports/storage/evidence-storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TYPES = ["image/jpeg", "video/mp4", "application/gzip"] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 128;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

// 증거 파일 입력
export type EvidenceItem = Readonly<{
  name: string;
  contentType: (typeof TYPES)[number];
  sizeBytes: number;
  contentSha256?: string;
}>;

export type EvidenceInput = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseToken: string;
  items: readonly EvidenceItem[];
}>;

export type EvidenceResult =
  | Readonly<{
      kind: "GRANTED";
      items: readonly Readonly<{ name: string; objectKey: string; uploadUrl: string; headers?: Readonly<Record<string, string>> }>[];
    }>
  | Exclude<EvidenceAccess, Readonly<{ kind: "AUTHORIZED"; analysisId: string }>>
  | Readonly<{ kind: "UNAVAILABLE" }>
  | Readonly<{ kind: "INVALID_INPUT"; reason: "JOB" | "WORKER" | "REVISION" | "LEASE" | "ITEMS" }>;

export type EvidenceDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: EvidenceStore;
  storage: EvidenceStorage;
}>;

const validItems = (items: readonly EvidenceItem[]): boolean => {
  // 증거 항목 개수 확인
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return false;
  // 전체 증거 용량 초기화
  let total = 0;
  let gzip = 0;
  // 증거 항목별 형식과 크기 확인
  for (const item of items) {
    if (!NAME.test(item.name) || !TYPES.includes(item.contentType)) return false;
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0) return false;
    if (item.contentType === "application/gzip") {
      gzip += 1;
      if (gzip > 1 || item.sizeBytes > MAX_DIAGNOSTIC_BYTES ||
        typeof item.contentSha256 !== "string" || !SHA256.test(item.contentSha256)) return false;
    } else if (item.contentSha256 !== undefined) {
      return false;
    } else if (item.sizeBytes > MAX_MEDIA_BYTES) {
      return false;
    }
    total += item.sizeBytes;
  }
  // 전체 증거 용량 제한 확인
  return total <= MAX_TOTAL_BYTES;
};

export const evidence =
  ({ clock, hasher, repository, storage }: EvidenceDependencies) =>
  async (input: EvidenceInput): Promise<EvidenceResult> => {
    // 작업 입력 검증
    if (!UUID.test(input.jobId)) return { kind: "INVALID_INPUT", reason: "JOB" };
    const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
    if (!workerId || workerId.length > 128) return { kind: "INVALID_INPUT", reason: "WORKER" };
    if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
      return { kind: "INVALID_INPUT", reason: "REVISION" };
    }
    if (typeof input.leaseToken !== "string" || !input.leaseToken.trim()) {
      return { kind: "INVALID_INPUT", reason: "LEASE" };
    }
    if (!validItems(input.items)) return { kind: "INVALID_INPUT", reason: "ITEMS" };

    // Lease 권한 확인
    const access = await repository.access({
      jobId: input.jobId.toLowerCase(),
      workerId,
      jobRevision: input.jobRevision,
      leaseTokenHash: Uint8Array.from(await hasher.sha256(input.leaseToken)),
      now: clock.now().toISOString(),
    });
    // 권한이 없으면 저장소 접근 차단
    if (access.kind !== "AUTHORIZED") return access;
    const diagnostic = input.items.some((item) => item.contentType === "application/gzip");
    if (diagnostic && !storage.perception) return { kind: "UNAVAILABLE" };
    // 증거 업로드 주소 병렬 발급
    const items = await Promise.all(input.items.map(async (item) => {
      if (item.contentType === "application/gzip") {
        return {
          name: item.name,
          ...await storage.perception!({
            analysisId: access.analysisId,
            jobId: input.jobId.toLowerCase(),
            jobRevision: input.jobRevision,
            contentSha256: item.contentSha256!,
            sizeBytes: item.sizeBytes,
          }),
        };
      }
      return {
        name: item.name,
        ...await storage.evidence({
          analysisId: access.analysisId,
          jobId: input.jobId.toLowerCase(),
          name: item.name,
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
        }),
      };
    }));
    // 증거 업로드 주소 반환
    return { kind: "GRANTED", items };
  };
