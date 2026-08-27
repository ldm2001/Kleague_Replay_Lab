import { S3Client } from "@aws-sdk/client-s3";
import {
  hash,
  s3,
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
import type { UploadApiDependencies } from "../api/upload-routes";
import { mediaPolicy, sessionPolicy } from "../config/media-policy";

const clock: Clock = { now: () => new Date() };

let cached: UploadApiDependencies | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const container = (): UploadApiDependencies => {
  if (cached) return cached;

  const database = client(env("DATABASE_URL"));
  const endpoint = env("STORAGE_ENDPOINT");
  const storage = s3({
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
  const sessions = sessionRepo(database);
  const uploads = uploadRepo(database);
  const hasher = hash();
  const issue = session({ clock, policy: sessionPolicy, repository: sessions });
  const sessionRecord = record({ clock, hasher, repository: sessions });
  const uploadCase = upload({ clock, policy: mediaPolicy, storage, repository: uploads });
  const completionCase = completion({ clock, policy: mediaPolicy, storage, repository: uploads });

  cached = {
    issue,
    resolve: sessionRecord,
    upload: uploadCase,
    complete: completionCase,
  };
  return cached;
};
