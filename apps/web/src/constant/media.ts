// 영상과 세션 정책
import type { SessionPolicy, UploadPolicy } from "@replay/application";

// 영상 크기와 형식 및 보존 기간을 변경 불가 정책으로 생성
export const mediaPolicy: UploadPolicy = Object.freeze({
    // 업로드 가능한 최대 바이트 크기 연결
    maxBytes: 2 * 1024 * 1024 * 1024,
    // 업로드를 허용할 영상 형식 목록 연결
    allowedContentTypes: Object.freeze(["video/mp4", "video/quicktime", "video/webm"]),
    // 업로드 권한의 밀리초 유효 기간 연결
    uploadIntentTtlMs: 15 * 60 * 1000,
    // 원본 영상의 밀리초 보존 기간 연결
    sourceTtlMs: 24 * 60 * 60 * 1000,
    // 영상 보존 정책 판본 연결
    mediaPolicyVersion: "media-v1",
    // 영상 검증 작업 본문 판본 연결
    validationJobPayloadVersion: 1,
    // 영상 검증의 최대 시도 횟수 연결
    validationMaxAttempts: 3,
});

// 익명 세션의 하루 유효 기간을 변경 불가 정책으로 생성
export const sessionPolicy: SessionPolicy = Object.freeze({ ttlMs: 24 * 60 * 60 * 1000 });
