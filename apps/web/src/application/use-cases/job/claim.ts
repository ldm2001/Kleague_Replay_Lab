// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 영상 작업의 임대와 결과 처리 계약 가져옴
import type { JobClaim, JobStore, JobType } from "../../ports/repositories/job-store";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { JobSourceStorage } from "../../ports/storage/upload-storage";

// 작업자가 선점할 수 있는 영상 처리 작업 종류 정의
const TYPES = ["VALIDATE_VIDEO", "ANALYZE_VIDEO"] as const satisfies readonly JobType[];

// 작업 선점 입력 계약 정의
export type ClaimInput = Readonly<{
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 영상 검증과 분석의 작업 구분
    jobType: JobType;
}>;

// 작업 선점 부적합 사유 정의
export type ClaimInvalidReason = "WORKER_ID" | "JOB_TYPE";

// 작업 선점 결과 정의
export type ClaimResult = JobClaim | null | Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "INVALID_INPUT";
    // 입력 거부 또는 처리 보류 사유
    reason: ClaimInvalidReason;
}>;

// 작업 선점 의존 기능 계약 정의
export type ClaimDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: JobStore;
    // 값의 출처 또는 원본 접근 수단
    source: JobSourceStorage;
    // 작업 선점 권한의 유효 기간 밀리초
    leaseMs: number;
}>;

// 작업자 작업 유형 확인
const type = (value: JobType): value is (typeof TYPES)[number] =>
    TYPES.includes(value as (typeof TYPES)[number]);

// 작업 선점 유스케이스
export const claim =
    ({ clock, repository, source, leaseMs }: ClaimDependencies) =>
    async (input: ClaimInput): Promise<ClaimResult> => {
        // 작업자 식별자 정규화
        const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
        // 작업자 식별자 검증
        if (workerId.length === 0 || workerId.length > 128) {
            // 잘못된 작업자 식별자 입력 결과 반환
            return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
        }
        // 작업 유형 검증
        if (!type(input.jobType)) {
            // 허용되지 않은 작업 종류 입력 결과 반환
            return { kind: "INVALID_INPUT", reason: "JOB_TYPE" };
        }

        // 현재 시각 조회
        const now = clock.now();
        // 작업 임대 만료 시각 계산
        const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
        // 작업 선점 요청
        const item = await repository.claim({
            // 작업을 수행하는 실행자의 식별자
            workerId,
            // 영상 검증과 분석의 작업 구분
            jobType: input.jobType,
            // 유효 기한 판단에 사용하는 현재 시각
            now: now.toISOString(),
            // 현재 작업 임대의 유효 기한
            leaseUntil,
        });
        // 선점 결과가 없으면 작업 없음 반환
        if (!item || !item.objectKey) return item;
        // 저장소 원본 주소 연결
        return { ...item, sourceUrl: await source.read(item.objectKey) };
    };
