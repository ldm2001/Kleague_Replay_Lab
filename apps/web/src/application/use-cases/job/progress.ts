import type { Clock } from "../../ports/clock/clock";
import type { Hasher } from "../../ports/hashing/hasher";
import type {
  JobProgress,
  JobProgressRepository,
  JobStage,
} from "../../ports/repositories/job-repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = [
  "VALIDATING",
  "SEGMENTING",
  "DETECTING",
  "EXTRACTING_FACTS",
  "BUILDING_EVIDENCE",
  "APPLYING_RULES",
] as const satisfies readonly JobStage[];

export type ProgressInput = Readonly<{
  jobId: string;
  workerId: string;
  jobRevision: number;
  leaseToken: string;
  stage: JobStage;
  progressPercent: number;
  message?: string;
}>;

export type ProgressInvalidReason =
  | "JOB_ID"
  | "WORKER_ID"
  | "REVISION"
  | "LEASE"
  | "STAGE"
  | "PROGRESS";

export type ProgressResult = JobProgress | Readonly<{
  kind: "INVALID_INPUT";
  reason: ProgressInvalidReason;
}>;

export type ProgressDependencies = Readonly<{
  clock: Clock;
  hasher: Hasher;
  repository: JobProgressRepository;
  leaseMs: number;
}>;

// 진행 단계 확인
const stage = (value: JobStage): value is (typeof STAGES)[number] => STAGES.includes(value as (typeof STAGES)[number]);

// 작업 진행 유스케이스
export const progress =
  ({ clock, hasher, repository, leaseMs }: ProgressDependencies) =>
  async (input: ProgressInput): Promise<ProgressResult> => {
    // 작업 식별자 형식 확인
    if (!UUID.test(input.jobId)) {
      return { kind: "INVALID_INPUT", reason: "JOB_ID" };
    }
    // Worker 식별자 형식 확인
    const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
    if (workerId.length === 0 || workerId.length > 128) {
      return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
    }
    // Revision 형식 확인
    if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
      return { kind: "INVALID_INPUT", reason: "REVISION" };
    }
    // Lease 토큰 형식 확인
    if (typeof input.leaseToken !== "string" || input.leaseToken.trim().length === 0) {
      return { kind: "INVALID_INPUT", reason: "LEASE" };
    }
    // 진행 단계 확인
    if (!stage(input.stage)) {
      return { kind: "INVALID_INPUT", reason: "STAGE" };
    }
    // 진행률 범위 확인
    if (!Number.isSafeInteger(input.progressPercent) || input.progressPercent < 0 || input.progressPercent > 100) {
      return { kind: "INVALID_INPUT", reason: "PROGRESS" };
    }

    // Lease 토큰 해시 생성
    const leaseTokenHash = Uint8Array.from(await hasher.sha256(input.leaseToken));
    // 현재 시각 조회
    const now = clock.now();
    // Lease 만료 시각 계산
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    // 진행 정보 저장
    return repository.progress({
      jobId: input.jobId.toLowerCase(),
      workerId,
      jobRevision: input.jobRevision,
      leaseTokenHash,
      stage: input.stage,
      progressPercent: input.progressPercent,
      now: now.toISOString(),
      leaseUntil,
      message: input.message?.trim() || null,
    });
  };
