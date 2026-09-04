import { evaluationRepo, hash, sessionRepo } from "@replay/adapters";
import { decision, facts, evaluate, record, type Clock } from "@replay/application";
import { pushResult, varResult } from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";
import { client } from "@replay/database";
import type { EvaluationApiDependencies } from "../apis/candidate";

const clock: Clock = { now: () => new Date() };

let cached: EvaluationApiDependencies | undefined;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const evaluation = (): EvaluationApiDependencies => {
  if (cached) return cached;
  const database = client(env("DATABASE_URL"));
  const sessions = sessionRepo(database);
  const hasher = hash();
  const resolve = record({ clock, hasher, repository: sessions });
  const repository = evaluationRepo(database);
  const run = evaluate({ rule: ruleSet, push: pushResult, variable: varResult, hash: (value) => hasher.sha256(value) });
  cached = {
    resolve,
    facts: facts({ clock, hasher, repository }),
    decision: decision({ clock, repository, run }),
  };
  return cached;
};
