// 객체 저장소 연결
import { S3Client } from "@aws-sdk/client-s3";
// 저장소와 외부 기능 구현 가져옴
import { s3, type S3Storage } from "@replay/adapters";

// 요청마다 재생성하지 않을 의존 객체 보관 위치 마련
let cached: S3Storage | undefined;

// 환경 변수 조회
const env = (name: string): string => {
    // 환경 변수 값 읽기
    const value = process.env[name];
    // 필수 환경 변수 확인
    if (!value) throw new Error(`${name} is required`);
    // 환경 변수 반환
    return value;
};

// 객체 저장소 의존성 조립
export const storage = (): S3Storage => {
    // 기존 저장소 재사용
    if (cached) return cached;
    // 저장소 주소 조회
    const endpoint = env("STORAGE_ENDPOINT");
    // 저장소 클라이언트 생성
    cached = s3({
        // 외부 저장소와 통신하는 연결
        client: new S3Client({
            // 객체 저장소 요청을 보낼 주소
            endpoint,
            // 객체 저장소의 서비스 지역
            region: process.env.STORAGE_REGION ?? "us-east-1",
            // 저장 영역을 주소 경로에 포함할지 여부
            forcePathStyle: endpoint.includes("localhost") || endpoint.includes("127.0.0.1"),
            // 객체 저장소에 접근하는 인증 정보
            credentials: {
                // 객체 저장소 인증 키의 식별자
                accessKeyId: env("STORAGE_ACCESS_KEY_ID"),
                // 객체 저장소 인증에 사용하는 비밀 키
                secretAccessKey: env("STORAGE_SECRET_ACCESS_KEY"),
            },
        }),
        // 파일을 저장하는 객체 저장소 영역
        bucket: env("STORAGE_BUCKET"),
    });
    // 저장소 반환
    return cached;
};
