// 상태 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { latest as latestCase, record, status } from "@replay/application";
// 영상과 분석 진행 상태 조회 계약 가져옴
import type { StatusApiDependencies } from "../apis/status";
// 프로세스 공용 시계와 데이터베이스 연결 가져옴
import { clock, pool } from "./runtime";

// 상태 의존성 캐시
let cached: StatusApiDependencies | undefined;

// 영상 상태 의존성 조립
export const mediaStatus = (): StatusApiDependencies => {
    // 기존 의존성 재사용
    if (cached) return cached;
    // 프로세스 공용 데이터베이스 연결 조회
    const database = pool();
    // 세션 저장소 생성
    const sessions = sessionStore(database);
    // 상태 저장소 생성
    const repository = statusStore(database);
    // 세션 조회 유스케이스 생성
    const resolve = record({ clock, hasher: hash(), repository: sessions });
    // 상태 의존성 저장
    cached = {
        // 접근 토큰에서 세션 기록을 찾는 기능
        resolve,
        // 처리 상태 또는 요청 응답 상태
        status: status({ clock, repository }),
        // 현재 세션의 최근 업로드 조회 기능
        latest: latestCase({ clock, repository }),
    };
    // 상태 의존성 반환
    return cached;
};
