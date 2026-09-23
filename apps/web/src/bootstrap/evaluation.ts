// 평가 어댑터 연결
import { evaluationStore, hash, sessionStore } from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { decision, facts, assessment, record, type Clock } from "@replay/application";
// 규정 자료와 평가 기능 가져옴
import { pushResult, varResult } from "@replay/rule-engine";
// 규정 자료와 평가 기능 가져옴
import { competitionSet, ruleSet } from "@replay/rule-data";
// 데이터베이스 연결과 저장 구조 가져옴
import { client } from "@replay/database";
// 후보 사실과 평가 처리 계약 가져옴
import type { EvaluationApiDependencies } from "../apis/candidate";

// 유효 기한 계산에 실제 현재 시각을 제공하는 시계 생성
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
    const run = assessment({
        // 경기 문맥에 맞춰 연결한 규정 자료
        rule: ruleSet,
        // 검증된 대회별 규정을 찾는 기능
        competitionRule: competitionSet,
        // 밀기 질문의 규정 평가 또는 사실 자료
        push: pushResult,
        // 영상 판독 적용 조건의 사실 자료
        variable: varResult,
        // 토큰이나 사실 내용의 동일성 대조 기능
        hash: (value) => hasher.sha256(value)
    });
    // 평가 의존성 저장
    cached = {
        // 접근 토큰에서 세션 기록을 찾는 기능
        resolve,
        // 확인된 출처와 판본을 보존하는 규정 사실 자료
        facts: facts({ clock, hasher, repository }),
        // 사실과 규정을 대조하는 판단 처리
        decision: decision({ clock, repository, run })
    };
    // 평가 의존성 반환
    return cached;
};
