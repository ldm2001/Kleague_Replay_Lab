// 상태 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
import { latest as latestCase, record, status, type Clock } from "@replay/application";
import { client } from "@replay/database";
import type { StatusApiDependencies } from "../apis/status";

const clock: Clock = { now: () => new Date() };

// 상태 의존성 캐시
let cached: StatusApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  // 환경 변수 값 읽기
  const value = process.env[name];
  // 필수 환경 변수 확인
  if (!value) throw new Error(`${name} is required`);
  // 환경 변수 반환
  return value;
};

// 영상 상태 의존성 조립
export const mediaStatus = (): StatusApiDependencies => {
  // 기존 의존성 재사용
  if (cached) return cached;
  // 데이터베이스 연결 생성
  const database = client(env("DATABASE_URL"));
  // 세션 저장소 생성
  const sessions = sessionStore(database);
  // 상태 저장소 생성
  const repository = statusStore(database);
  // 세션 조회 유스케이스 생성
  const resolve = record({ clock, hasher: hash(), repository: sessions });
  // 상태 의존성 저장
  cached = {
    resolve,
    status: status({ clock, repository }),
    latest: latestCase({ clock, repository }),
  };
  // 상태 의존성 반환
  return cached;
};
