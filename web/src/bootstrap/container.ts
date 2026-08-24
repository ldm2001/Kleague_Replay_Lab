import { S3Client } from "@aws-sdk/client-s3";
import {
  hash,
  s3,
  sessionRepo,
  uploadRepo,
} from "@replay/adapters";
import {
  complete,
  resolve,
  session,
  upload,
  type Clock,
} from "@replay/application";
import { client } from "@replay/database";
import type { UploadApiDependencies } from "../api/upload-routes";
import { mediaPolicy, sessionPolicy } from "../config/media-policy";

const clock: Clock = { now: () => new Date() };

let cached: UploadApiDependencies | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const container = (): UploadApiDependencies => {
  if (cached) return cached;

  const database = client(required("DATABASE_URL"));
  const endpoint = required("STORAGE_ENDPOINT");
  const storage = s3({
    client: new S3Client({
      endpoint,
      region: process.env.STORAGE_REGION ?? "us-east-1",
      forcePathStyle: endpoint.includes("localhost") || endpoint.includes("127.0.0.1"),
      credentials: {
        accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
      },
    }),
    bucket: required("STORAGE_BUCKET"),
  });
  const sessions = sessionRepo(database);
  const uploads = uploadRepo(database);
  const hasher = hash();
  const issue = session({ clock, policy: sessionPolicy, repository: sessions });
  const resolveSession = resolve({ clock, hasher, repository: sessions });
  const create = upload({ clock, policy: mediaPolicy, storage, repository: uploads });
  const finish = complete({ clock, policy: mediaPolicy, storage, repository: uploads });

  cached = {
    issue,
    resolve: resolveSession,
    upload: create,
    complete: finish,
  };
  return cached;
};
