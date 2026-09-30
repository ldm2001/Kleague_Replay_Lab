// 증거 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { asset, record } from "@replay/application";
// 증거 자산 접근과 저장 계약 가져옴
import type { EvidenceApiDependencies } from "../apis/evidence";
// 원본과 증거 파일 저장 기능 가져옴
import { storage } from "./storage";
// 프로세스 공용 시계와 데이터베이스 연결 가져옴
import { clock, pool } from "./runtime";

// 증거 의존성 캐시
let cached: EvidenceApiDependencies | undefined;

// 증거 의존성 조립
export const mediaEvidence = (): EvidenceApiDependencies => {
    // 기존 의존성 재사용
    if (cached) return cached;
    // 프로세스 공용 데이터베이스 연결 조회
    const database = pool();
    // 세션 저장소 생성
    const sessions = sessionStore(database);
    // 증거 조회 저장소 생성
    const repository = statusStore(database);
    // 객체 저장소 생성
    const source = storage();
    // 증거 의존성 저장
    cached = {
        // 접근 토큰에서 세션 기록을 찾는 기능
        resolve: record({ clock, hasher: hash(), repository: sessions }),
        // 소유권에 맞는 증거 자산 조회 기능
        asset: asset({ clock, repository }),
        // 요청 바이트 구간이 있으면 해당 구간만 읽는 자료 본문
        body: (objectKey, range) => source.body(objectKey, range),
    };
    // 증거 의존성 반환
    return cached;
};
