// 저장소와 외부 기능 구현 가져옴
import {
    hash,
    secret,
    sessionStore,
    uploadStore,
} from "@replay/adapters";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import { completion, record, session, upload } from "@replay/application";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { UploadApiDependencies } from "../apis/upload";
// 업로드와 보존 기간의 서비스 정책 가져옴
import { mediaPolicy, sessionPolicy } from "./media";
// 원본과 증거 파일 저장 기능 가져옴
import { storage as objectStorage } from "./storage";
// 프로세스 공용 시계와 데이터베이스 연결 가져옴
import { clock, pool } from "./runtime";

// 요청마다 재생성하지 않을 의존 객체 보관 위치 마련
let cached: UploadApiDependencies | undefined;

// 의존성 조립 지점
export const container = (): UploadApiDependencies => {
    // 기존 의존성 조회
    if (cached) return cached;

    // 프로세스 공용 데이터베이스 연결 조회
    const database = pool();
    // 객체 저장소 어댑터 생성
    const storage = objectStorage();
    // 세션 저장소 생성
    const sessions = sessionStore(database);
    // 업로드 저장소 생성
    const uploads = uploadStore(database);
    // 해시 어댑터 생성
    const hasher = hash();
    // 세션 발급 유스케이스 생성
    const issue = session({
        clock,
        hasher,
        policy: sessionPolicy,
        repository: sessions,
        secret: secret()
    });
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
        // 세션 발급과 같은 유효 기간을 쿠키 보존 시간으로 쓰는 세션 정책
        session: sessionPolicy,
    };
    // 의존성 묶음 반환
    return cached;
};
