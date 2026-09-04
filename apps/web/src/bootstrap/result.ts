import { hash, sessionRepo, statusRepo } from "@replay/adapters";
import { record, report, type Clock } from "@replay/application";
import { client } from "@replay/database";
import type { ResultApiDependencies } from "../apis/result";

const clock: Clock = { now: () => new Date() };

let cached: ResultApiDependencies | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const resultView = (): ResultApiDependencies => {
  if (cached) return cached;
  const database = client(env("DATABASE_URL"));
  const sessions = sessionRepo(database);
  const repository = statusRepo(database);
  cached = {
    resolve: record({ clock, hasher: hash(), repository: sessions }),
    report: report({ clock, repository }),
  };
  return cached;
};
