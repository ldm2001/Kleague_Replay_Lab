// 현재 시각 제공 계약 가져옴
import type { Clock } from "@replay/application";
// 데이터베이스 연결 생성 기능과 연결 계약 가져옴
import { client, type DatabaseClient } from "@replay/database";

// 유효 기한 계산에 실제 현재 시각을 제공하는 프로세스 공용 시계
export const clock: Clock = { now: () => new Date() };

// 모든 조립 지점이 공유할 단일 데이터베이스 연결 보관 위치 마련
let cached: DatabaseClient | undefined;

// 필수 환경 변수 조회
export const env = (name: string): string => {
    // 필수 실행 환경의 설정값 읽음
    const value = process.env[name];
    // 필수 환경 설정 누락 시 의존 객체 생성 중단
    if (!value) throw new Error(`${name} is required`);
    // 확인된 환경 설정값 반환
    return value;
};

// 트랜잭션이 바깥 연결을 다시 잡지 않는 전제로 프로세스 전체가 공유하는 데이터베이스 연결 반환
export const pool = (): DatabaseClient => {
    // 기존 연결 재사용
    if (cached) return cached;
    // 최초 요청에서만 데이터베이스 연결 생성
    cached = client(env("DATABASE_URL"));
    // 공용 연결 반환
    return cached;
};
