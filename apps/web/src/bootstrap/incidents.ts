// 비공개 사건 조회 기능 가져옴
import { incidentQuery } from "@replay/adapters";
// 내부 사건 조회의 인증과 조회 계약 가져옴
import type { IncidentApiDependencies } from "../apis/incidents";
// 프로세스 공용 설정과 시계 및 데이터베이스 연결 가져옴
import { clock, env, pool } from "./runtime";

// 비공개 조회 전용 의존성을 공개 분석 응답과 분리하여 보관할 위치 마련
let cached: IncidentApiDependencies | undefined;

// 요청 사이에서 재사용할 내부 조회 의존성 반환
export const incidentDependencies = (): IncidentApiDependencies => {
    // 기존 의존성 재사용
    if (cached) return cached;
    // 작업자 요청 인증 비밀 값 조회
    const key = env("WORKER_AUTH_TOKEN");
    // 프로세스 공용 데이터베이스 연결 조회
    const database = pool();
    // 내부 조회 의존성 저장
    cached = {
        // 작업자 요청 인증에 사용하는 비밀 값
        key,
        // 조회 시점의 현재 시각으로 공개 가능 조건을 적용한 사건 목록 조회
        query: (input) => incidentQuery(database, input, clock.now().toISOString())
    };
    // 내부 조회 의존성 반환
    return cached;
};
