// 증거 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
import { asset, record, type Clock } from "@replay/application";
import { client } from "@replay/database";
import type { EvidenceApiDependencies } from "../apis/evidence";
import { storage } from "./storage";

const clock: Clock = { now: () => new Date() };

let cached: EvidenceApiDependencies | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const mediaEvidence = (): EvidenceApiDependencies => {
  if (cached) return cached;
  const database = client(env("DATABASE_URL"));
  const sessions = sessionStore(database);
  const repository = statusStore(database);
  const source = storage();
  cached = {
    resolve: record({ clock, hasher: hash(), repository: sessions }),
    asset: asset({ clock, repository }),
    body: (objectKey) => source.body(objectKey),
  };
  return cached;
};
