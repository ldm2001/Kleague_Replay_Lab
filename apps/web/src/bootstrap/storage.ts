// 객체 저장소 연결
import { S3Client } from "@aws-sdk/client-s3";
import { s3, type S3Storage } from "@replay/adapters";

let cached: S3Storage | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const storage = (): S3Storage => {
  if (cached) return cached;
  const endpoint = env("STORAGE_ENDPOINT");
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
  return cached;
};
