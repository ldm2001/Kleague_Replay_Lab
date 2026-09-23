// 증거 어댑터 연결
import { hash, sessionStore, statusStore } from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { asset, record, type Clock } from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import { client } from "@replay/database";
// 증거 자산 접근과 저장 계약 가져옴
import type { EvidenceApiDependencies } from "../apis/evidence";
// 원본과 증거 파일 저장 기능 가져옴
import { storage } from "./storage";

// 유효 기한 계산에 실제 현재 시각을 제공하는 시계 생성
const clock: Clock = { now: () => new Date() };

// 증거 의존성 캐시
let cached: EvidenceApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
    // 환경 변수 값 읽기
    const value = process.env[name];
    // 필수 환경 변수 확인
    if (!value) throw new Error(`${name} is required`);
    // 환경 변수 반환
    return value;
};

// 증거 의존성 조립
export const mediaEvidence = (): EvidenceApiDependencies => {
    // 기존 의존성 재사용
    if (cached) return cached;
    // 데이터베이스 연결 생성
    const database = client(env("DATABASE_URL"));
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
        // 응답하거나 저장소에서 읽는 자료 본문
        body: (objectKey) => source.body(objectKey),
    };
    // 증거 의존성 반환
    return cached;
};
