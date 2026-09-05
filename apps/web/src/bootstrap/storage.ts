// 객체 저장소 연결
import { S3Client } from "@aws-sdk/client-s3";
import { s3, type S3Storage } from "@replay/adapters";

let cached: S3Storage | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  // 환경 변수 값 읽기
  const value = process.env[name];
  // 필수 환경 변수 확인
  if (!value) throw new Error(`${name} is required`);
  // 환경 변수 반환
  return value;
};

// 객체 저장소 의존성 조립
export const storage = (): S3Storage => {
  // 기존 저장소 재사용
  if (cached) return cached;
  // 저장소 주소 조회
  const endpoint = env("STORAGE_ENDPOINT");
  // 저장소 클라이언트 생성
  cached = s3({
    client: new S3Client({
      endpoint,
      region: process.env.STORAGE_REGION ?? "us-east-1",
      forcePathStyle: endpoint.includes("localhost") || endpoint.includes("127.0.0.1"),
      credentials: {
        accessKeyId: env("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: env("STORAGE_SECRET_ACCESS_KEY"),
      },
    }),
    bucket: env("STORAGE_BUCKET"),
  });
  // 저장소 반환
  return cached;
};
