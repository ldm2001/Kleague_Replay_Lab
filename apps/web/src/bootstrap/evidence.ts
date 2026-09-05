// 증거 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
import { asset, record, type Clock } from "@replay/application";
import { client } from "@replay/database";
import type { EvidenceApiDependencies } from "../apis/evidence";
import { storage } from "./storage";

const clock: Clock = { now: () => new Date() };

// 증거 의존성 캐시
let cached: EvidenceApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  // 환경 변수 값 읽기
  const value = process.env[name];
  // 필수 환경 변수 확인
  if (!value) throw new Error(`${name} is required`);
  // 환경 변수 반환
  return value;
};

// 증거 의존성 조립
export const mediaEvidence = (): EvidenceApiDependencies => {
  // 기존 의존성 재사용
  if (cached) return cached;
  // 데이터베이스 연결 생성
  const database = client(env("DATABASE_URL"));
  // 세션 저장소 생성
  const sessions = sessionStore(database);
  // 증거 조회 저장소 생성
  const repository = statusStore(database);
  // 객체 저장소 생성
  const source = storage();
  // 증거 의존성 저장
  cached = {
    resolve: record({ clock, hasher: hash(), repository: sessions }),
    asset: asset({ clock, repository }),
    body: (objectKey) => source.body(objectKey),
  };
  // 증거 의존성 반환
  return cached;
};
