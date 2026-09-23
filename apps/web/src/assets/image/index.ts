// 기본 로고 불러오기
import brand from "./brand/kleague-logo.png";
// 밝은 배경용 로고 불러오기
import brandLight from "./brand/kleague-logo-light.png";
// 검토 범위 이미지 불러오기
import charging from "./review/charging.webp";
import foul from "./review/foul.jpg";
import goal from "./review/goal.jpg";
import handball from "./review/handball.jpg";
// 영웅 이미지 불러오기
import hero from "./hero/kleague-ball.jpg";

// 이미지 자산 경로
// 이미지 자산 타입
export type Asset = string | { src: string };

// 자산 경로 변환
// 이미지 자산 주소 변환
export const path = (asset: Asset) => typeof asset === "string" ? asset : asset.src;

// 이미지 묶음
// 화면 이미지 묶음
export const images = {
    // 기본 리그 로고 연결
    brand,
    // 밝은 리그 로고 연결
    brandLight,
    // 첫 화면 배경 이미지 연결
    hero,
    // 검토 범위 이미지 묶음 연결
    review: {
        // 파울 예시 이미지 연결
        foul,
        // 핸드볼 예시 이미지 연결
        handball,
        // 차징 예시 이미지 연결
        charging,
        // 득점 예시 이미지 연결
        goal,
    },
} as const;
