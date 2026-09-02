import type { Clock } from "../../ports/clock/clock";
import type { JobClaim, JobRepository, JobType } from "../../ports/repositories/job-repo";
import type { JobSourceStorage } from "../../ports/storage/upload-storage";

const TYPES = ["VALIDATE_VIDEO", "ANALYZE_VIDEO"] as const satisfies readonly JobType[];

export type ClaimInput = Readonly<{
  workerId: string;
  jobType: JobType;
}>;

export type ClaimInvalidReason = "WORKER_ID" | "JOB_TYPE";

export type ClaimResult = JobClaim | null | Readonly<{
  kind: "INVALID_INPUT";
  reason: ClaimInvalidReason;
}>;

export type ClaimDependencies = Readonly<{
  clock: Clock;
  repository: JobRepository;
  source: JobSourceStorage;
  leaseMs: number;
}>;

// Worker 작업 유형 확인
const type = (value: JobType): value is (typeof TYPES)[number] => TYPES.includes(value as (typeof TYPES)[number]);

// 작업 선점 유스케이스
export const claim =
  ({ clock, repository, source, leaseMs }: ClaimDependencies) =>
  async (input: ClaimInput): Promise<ClaimResult> => {
    // Worker 식별자 정규화
    const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
    // Worker 식별자 검증
    if (workerId.length === 0 || workerId.length > 128) {
      return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
    }
    // 작업 유형 검증
    if (!type(input.jobType)) {
      return { kind: "INVALID_INPUT", reason: "JOB_TYPE" };
    }

    // 현재 시각 조회
    const now = clock.now();
    // Lease 만료 시각 계산
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    // 작업 선점 요청
    const item = await repository.claim({
      workerId,
      jobType: input.jobType,
      now: now.toISOString(),
      leaseUntil,
    });
    if (!item || !item.objectKey) return item;
    return { ...item, sourceUrl: await source.read(item.objectKey) };
  };
