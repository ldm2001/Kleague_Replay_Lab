// 평가 어댑터 연결
import { evaluationStore, hash, sessionStore } from "@replay/adapters";
import { decision, facts, assessment, record, type Clock } from "@replay/application";
import { pushResult, varResult } from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";
import { client } from "@replay/database";
import type { EvaluationApiDependencies } from "../apis/candidate";

const clock: Clock = { now: () => new Date() };

// 평가 의존성 캐시
let cached: EvaluationApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
  // 환경 변수 값 읽기
  const value = process.env[name];
  // 필수 환경 변수 확인
  if (!value) throw new Error(`${name} is required`);
  // 환경 변수 반환
  return value;
};

// 평가 의존성 조립
export const evaluation = (): EvaluationApiDependencies => {
  // 기존 의존성 재사용
  if (cached) return cached;
  // 데이터베이스 연결 생성
  const database = client(env("DATABASE_URL"));
  // 세션 저장소 생성
  const sessions = sessionStore(database);
  // 해시 어댑터 생성
  const hasher = hash();
  // 세션 조회 유스케이스 생성
  const resolve = record({ clock, hasher, repository: sessions });
  // 사실과 판정 저장소 생성
  const repository = evaluationStore(database);
  // 규정 엔진 조립
  const run = assessment({ rule: ruleSet, push: pushResult, variable: varResult, hash: (value) => hasher.sha256(value) });
  // 평가 의존성 저장
  cached = {
    resolve,
    facts: facts({ clock, hasher, repository }),
    decision: decision({ clock, repository, run }),
  };
  // 평가 의존성 반환
  return cached;
};
