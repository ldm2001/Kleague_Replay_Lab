import { claim, evidence as evidenceCase, progress as progressCase, result as resultCase, type Clock } from "@replay/application";
import { hash, jobStore } from "@replay/adapters";
import { client } from "@replay/database";
import type { JobApiDependencies } from "../apis/job";
import { storage } from "./storage";

const clock: Clock = { now: () => new Date() };

let cached: JobApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

// Lease 시간 조회
const lease = (): number => {
  const value = Number(process.env.WORKER_LEASE_MS ?? 30_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("WORKER_LEASE_MS is invalid");
  }
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
  // Object Storage 생성
  const source = storage();
  // 해시 어댑터 생성
  const hasher = hash();
  // 작업 선점 유스케이스 생성
  const operation = claim({ clock, repository, source, leaseMs: lease() });
  // 진행 유스케이스 생성
  const state = progressCase({ clock, hasher, repository, leaseMs: lease() });
  // 작업 결과 유스케이스 생성
  const result = resultCase({ clock, hasher, repository });
  // 증거 업로드 권한 유스케이스 생성
  const evidence = evidenceCase({ clock, hasher, repository, storage: source });
  // 작업 의존성 저장
  cached = { key: env("WORKER_AUTH_TOKEN"), claim: operation, progress: state, result, evidence };
  // 작업 의존성 반환
  return cached;
};
