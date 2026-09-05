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
  brand,
  brandLight,
  hero,
  review: {
    foul,
    handball,
    charging,
    goal,
  },
} as const;
