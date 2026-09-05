// 상태 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
import { latest as latestCase, record, status, type Clock } from "@replay/application";
import { client } from "@replay/database";
import type { StatusApiDependencies } from "../apis/status";

const clock: Clock = { now: () => new Date() };

let cached: StatusApiDependencies | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const mediaStatus = (): StatusApiDependencies => {
  if (cached) return cached;
  const database = client(env("DATABASE_URL"));
  const sessions = sessionStore(database);
  const repository = statusStore(database);
  const resolve = record({ clock, hasher: hash(), repository: sessions });
  cached = {
    resolve,
    status: status({ clock, repository }),
    latest: latestCase({ clock, repository }),
  };
  return cached;
};
