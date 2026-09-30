// 결과 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { record, report } from "@replay/application";
// 공개 결과 조회와 처리 계약 가져옴
import type { ResultApiDependencies } from "../apis/result";
// 프로세스 공용 시계와 데이터베이스 연결 가져옴
import { clock, pool } from "./runtime";

// 결과 의존성 캐시
let cached: ResultApiDependencies | undefined;

// 결과 의존성 조립
export const resultView = (): ResultApiDependencies => {
    // 기존 의존성 재사용
    if (cached) return cached;
    // 프로세스 공용 데이터베이스 연결 조회
    const database = pool();
    // 세션 저장소 생성
    const sessions = sessionStore(database);
    // 결과 조회 저장소 생성
    const repository = statusStore(database);
    // 결과 의존성 저장
    cached = {
        // 접근 토큰에서 세션 기록을 찾는 기능
        resolve: record({ clock, hasher: hash(), repository: sessions }),
        // 소유권 확인 후 공개 결과 조회 기능
        report: report({ clock, repository }),
    };
    // 결과 의존성 반환
    return cached;
};
