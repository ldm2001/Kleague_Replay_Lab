// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 영상 작업의 임대와 결과 처리 계약 가져옴
import type { JobProgress, JobProgressStore, JobStage } from "../../ports/repositories/job-store";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 작업자가 보고할 수 있는 진행 단계 목록 생성
const STAGES = [
    "VALIDATING",
    "SEGMENTING",
    "DETECTING",
    "EXTRACTING_FACTS",
    "BUILDING_EVIDENCE",
    "APPLYING_RULES",
] as const satisfies readonly JobStage[];

// 진행 보고 입력 계약 정의
export type ProgressInput = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 현재 작업 임대를 증명하는 비밀 토큰
    leaseToken: string;
    // 현재 영상 처리 단계
    stage: JobStage;
    // 작업 진행률의 백분율
    progressPercent: number;
    // 처리 진행 또는 실패의 안내 문구
    message?: string;
}>;

// 진행 보고 부적합 사유 정의
export type ProgressInvalidReason =
    | "JOB_ID"
    | "WORKER_ID"
    | "REVISION"
    | "LEASE"
    | "STAGE"
    | "PROGRESS";

// 진행 보고 결과 정의
export type ProgressResult = JobProgress | Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "INVALID_INPUT";
    // 입력 거부 또는 처리 보류 사유
    reason: ProgressInvalidReason;
}>;

// 진행 보고 의존 기능 계약 정의
export type ProgressDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: JobProgressStore;
    // 작업 선점 권한의 유효 기간 밀리초
    leaseMs: number;
}>;

// 진행 단계 확인
const stage = (value: JobStage): value is (typeof STAGES)[number] =>
    STAGES.includes(value as (typeof STAGES)[number]);

// 작업 진행 유스케이스
export const progress =
    ({ clock, hasher, repository, leaseMs }: ProgressDependencies) =>
    async (input: ProgressInput): Promise<ProgressResult> => {
        // 작업 식별자 형식 확인
        if (!UUID.test(input.jobId)) {
            // 작업 식별자 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "JOB_ID" };
        }
        // 작업자 식별자 형식 확인
        const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
        // 작업자 식별자의 빈 값과 길이 상한 확인
        if (workerId.length === 0 || workerId.length > 128) {
            // 작업자 식별자 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
        }
        // 개정 이력 형식 확인
        if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
            // 유효하지 않은 작업 판본 오류 반환
            return { kind: "INVALID_INPUT", reason: "REVISION" };
        }
        // 작업 임대 토큰 형식 확인
        if (typeof input.leaseToken !== "string" || input.leaseToken.trim().length === 0) {
            // 누락되거나 잘못된 임대 토큰 오류 반환
            return { kind: "INVALID_INPUT", reason: "LEASE" };
        }
        // 진행 단계 확인
        if (!stage(input.stage)) {
            // 허용하지 않는 작업 진행 단계 오류 반환
            return { kind: "INVALID_INPUT", reason: "STAGE" };
        }
        // 진행률 범위 확인
        if (
            !Number.isSafeInteger(input.progressPercent) ||
            input.progressPercent < 0 ||
            input.progressPercent > 100
        ) {
            // 범위를 벗어난 진행률 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "PROGRESS" };
        }

        // 작업 임대 토큰 해시 생성
        const leaseTokenHash = Uint8Array.from(await hasher.sha256(input.leaseToken));
        // 현재 시각 조회
        const now = clock.now();
        // 작업 임대 만료 시각 계산
        const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
        // 진행 메시지 정규화
        const message = input.message?.trim() || null;
        // 진행 정보 저장
        return repository.progress({
            // 처리 작업의 식별자
            jobId: input.jobId.toLowerCase(),
            // 작업을 수행하는 실행자의 식별자
            workerId,
            // 재실행 이전 요청을 구분하는 작업 판본
            jobRevision: input.jobRevision,
            // 작업 임대 권한 비교용 토큰 해시
            leaseTokenHash,
            // 현재 영상 처리 단계
            stage: input.stage,
            // 작업 진행률의 백분율
            progressPercent: input.progressPercent,
            // 유효 기한 판단에 사용하는 현재 시각
            now: now.toISOString(),
            // 현재 작업 임대의 유효 기한
            leaseUntil,
            // 처리 진행 또는 실패의 안내 문구
            message
        });
    };
