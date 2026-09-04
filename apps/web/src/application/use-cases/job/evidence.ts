import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type { EvidenceAccess, EvidenceAccessRepo } from "../../ports/repositories/evidence-repo";
import type { EvidenceStorage } from "../../ports/storage/evidence-storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TYPES = ["image/jpeg", "video/mp4"] as const;
const MAX_ITEMS = 128;
const MAX_ITEM_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export type EvidenceItem = Readonly<{
  name: string;
  contentType: (typeof TYPES)[number];
  sizeBytes: number;
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
      items: readonly Readonly<{ name: string; objectKey: string; uploadUrl: string }>[];
    }>
  | Exclude<EvidenceAccess, Readonly<{ kind: "AUTHORIZED"; analysisId: string }>>
  | Readonly<{ kind: "INVALID_INPUT"; reason: "JOB" | "WORKER" | "REVISION" | "LEASE" | "ITEMS" }>;

export type EvidenceDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: EvidenceAccessRepo;
  storage: EvidenceStorage;
}>;

const validItems = (items: readonly EvidenceItem[]): boolean => {
  if (items.length === 0 || items.length > MAX_ITEMS) return false;
  let total = 0;
  for (const item of items) {
    if (!NAME.test(item.name) || !TYPES.includes(item.contentType)) return false;
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0 || item.sizeBytes > MAX_ITEM_BYTES) return false;
    total += item.sizeBytes;
  }
  return total <= MAX_TOTAL_BYTES;
};

export const evidence =
  ({ clock, hasher, repository, storage }: EvidenceDependencies) =>
  async (input: EvidenceInput): Promise<EvidenceResult> => {
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

    const access = await repository.access({
      jobId: input.jobId.toLowerCase(),
      workerId,
      jobRevision: input.jobRevision,
      leaseTokenHash: Uint8Array.from(await hasher.sha256(input.leaseToken)),
      now: clock.now().toISOString(),
    });
    if (access.kind !== "AUTHORIZED") return access;
    const items = await Promise.all(input.items.map(async (item) => ({
      name: item.name,
      ...await storage.evidence({
        analysisId: access.analysisId,
        jobId: input.jobId.toLowerCase(),
        name: item.name,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
      }),
    })));
    return { kind: "GRANTED", items };
  };
