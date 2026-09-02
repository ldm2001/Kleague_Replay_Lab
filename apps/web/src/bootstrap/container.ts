import {
  hash,
  sessionRepo,
  uploadRepo,
} from "@replay/adapters";
import {
  completion,
  record,
  session,
  upload,
  type Clock,
} from "@replay/application";
import { client } from "@replay/database";
import type { UploadApiDependencies } from "../apis/upload";
import { mediaPolicy, sessionPolicy } from "../constant/media-policy";
import { storage as objectStorage } from "./storage";

const clock: Clock = { now: () => new Date() };

let cached: UploadApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

// 의존성 조립 지점
export const container = (): UploadApiDependencies => {
  // 기존 의존성 조회
  if (cached) return cached;

  // 데이터베이스 연결 생성
  const database = client(env("DATABASE_URL"));
  // Object Storage 어댑터 생성
  const storage = objectStorage();
  // 세션 저장소 생성
  const sessions = sessionRepo(database);
  // 업로드 저장소 생성
  const uploads = uploadRepo(database);
  // 해시 어댑터 생성
  const hasher = hash();
  // 세션 발급 유스케이스 생성
  const issue = session({ clock, policy: sessionPolicy, repository: sessions });
  // 세션 기록 유스케이스 생성
  const sessionRecord = record({ clock, hasher, repository: sessions });
  // 업로드 유스케이스 생성
  const uploadCase = upload({ clock, policy: mediaPolicy, storage, repository: uploads });
  // 완료 유스케이스 생성
  const completionCase = completion({ clock, policy: mediaPolicy, storage, repository: uploads });

  // 의존성 묶음 저장
  cached = {
    issue,
    resolve: sessionRecord,
    upload: uploadCase,
    complete: completionCase,
  };
  // 의존성 묶음 반환
  return cached;
};
