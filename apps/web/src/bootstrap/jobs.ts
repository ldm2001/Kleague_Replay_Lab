// 분석 처리 유스케이스와 저장소 계약 가져옴
import {
    claim,
    evidence as evidenceCase,
    progress as progressCase,
    result as resultCase,
    type Clock
} from "@replay/application";
// 저장소와 외부 기능 구현 가져옴
import { hash, jobStore } from "@replay/adapters";
// 데이터베이스 연결과 저장 구조 가져옴
import { client } from "@replay/database";
// 영상 작업의 임대와 결과 처리 계약 가져옴
import type { JobApiDependencies } from "../apis/job";
// 원본과 증거 파일 저장 기능 가져옴
import { storage } from "./storage";

// 유효 기한 계산에 실제 현재 시각을 제공하는 시계 생성
const clock: Clock = { now: () => new Date() };

// 요청마다 재생성하지 않을 의존 객체 보관 위치 마련
let cached: JobApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
    // 필수 실행 환경의 설정값 읽음
    const value = process.env[name];
    // 필수 환경 설정 누락 시 의존 객체 생성 중단
    if (!value) throw new Error(`${name} is required`);
    // 확인된 환경 설정값 반환
    return value;
};

// 작업 임대 시간 조회
const lease = (): number => {
    // 설정한 임대 시간을 읽고 미지정 시 기본 30초 적용
    const value = Number(process.env.WORKER_LEASE_MS ?? 30_000);
    // 임대 기간이 양의 안전한 정수인지 확인
    if (!Number.isSafeInteger(value) || value <= 0) {
        // 잘못된 임대 시간 설정을 오류로 전달
        throw new Error("WORKER_LEASE_MS is invalid");
    }
    // 검증된 작업 임대 기간 반환
    return value;
};

// 작업 의존성 조립
export const jobs = (): JobApiDependencies => {
    // 기존 의존성 조회
    if (cached) return cached;
    // 데이터베이스 연결 생성
    const database = client(env("DATABASE_URL"));
    // 작업 저장소 생성
    const repository = jobStore(database);
    // 객체 저장소 생성
    const source = storage();
    // 해시 어댑터 생성
    const hasher = hash();
    // 작업 선점 유스케이스 생성
    const operation = claim({ clock, repository, source, leaseMs: lease() });
    // 진행 유스케이스 생성
    const state = progressCase({ clock, hasher, repository, leaseMs: lease() });
    // 작업 결과 유스케이스 생성
    const result = resultCase({
        clock,
        hasher,
        repository,
        storage: source,
        // 원본 예외와 비밀값을 제외한 내부 실패 단계 기록
        diagnostic: ({ stage, jobId, jobRevision }) => {
            // 명시적으로 허용한 작업 메타데이터만 서버 로그 기록
            console.error("job-result-failure", { stage, jobId, jobRevision });
        }
    });
    // 증거 업로드 권한 유스케이스 생성
    const evidence = evidenceCase({ clock, hasher, repository, storage: source });
    // 작업 의존성 저장
    cached = { key: env("WORKER_AUTH_TOKEN"), claim: operation, progress: state, result, evidence };
    // 작업 의존성 반환
    return cached;
};
