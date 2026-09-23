// 저장소와 외부 기능 구현 가져옴
import {
    hash,
    sessionStore,
    uploadStore,
} from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { completion, record, session, upload, type Clock } from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import { client } from "@replay/database";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { UploadApiDependencies } from "../apis/upload";
// 업로드와 보존 기간의 서비스 정책 가져옴
import { mediaPolicy, sessionPolicy } from "../constant/media";
// 원본과 증거 파일 저장 기능 가져옴
import { storage as objectStorage } from "./storage";

// 유효 기한 계산에 실제 현재 시각을 제공하는 시계 생성
const clock: Clock = { now: () => new Date() };

// 요청마다 재생성하지 않을 의존 객체 보관 위치 마련
let cached: UploadApiDependencies | undefined;

// 환경 변수 조회
const env = (name: string): string => {
    // 필수 실행 환경의 설정값 읽음
    const value = process.env[name];
    // 필수 환경 설정 누락 시 의존 객체 생성 중단
    if (!value) throw new Error(`${name} is required`);
    // 확인된 환경 설정값 반환
    return value;
};

// 의존성 조립 지점
export const container = (): UploadApiDependencies => {
    // 기존 의존성 조회
    if (cached) return cached;

    // 데이터베이스 연결 생성
    const database = client(env("DATABASE_URL"));
    // 객체 저장소 어댑터 생성
    const storage = objectStorage();
    // 세션 저장소 생성
    const sessions = sessionStore(database);
    // 업로드 저장소 생성
    const uploads = uploadStore(database);
    // 해시 어댑터 생성
    const hasher = hash();
    // 세션 발급 유스케이스 생성
    const issue = session({ clock, policy: sessionPolicy, repository: sessions });
    // 세션 기록 유스케이스 생성
    const sessionRecord = record({ clock, hasher, repository: sessions });
    // 업로드 유스케이스 생성
    const uploadCase = upload({ clock, policy: mediaPolicy, storage, repository: uploads });
    // 완료 유스케이스 생성
    const completionCase = completion({ clock, policy: mediaPolicy, storage, repository: uploads });

    // 의존성 묶음 저장
    cached = {
        // 새 익명 세션 권한 발급 기능
        issue,
        // 접근 토큰에서 세션 기록을 찾는 기능
        resolve: sessionRecord,
        // 영상 업로드 허가 처리
        upload: uploadCase,
        // 업로드 완료와 후속 영상 검증 연결
        complete: completionCase,
    };
    // 의존성 묶음 반환
    return cached;
};
