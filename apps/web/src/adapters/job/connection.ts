// 데이터베이스 연결과 저장 구조 가져옴
import type { DatabaseClient } from "@replay/database";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
export type DatabaseHandle = Pick<DatabaseClient, "db">;
// 트랜잭션 안에서 질의를 실행하는 연결 부분 정의
export type Executor = Pick<DatabaseClient["db"], "execute">;
// 저장 직전 실제 시각을 읽는 시계 함수 정의
export type WallClock = () => Date;
