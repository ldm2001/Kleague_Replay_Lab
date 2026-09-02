import brand from "./brand/kleague-logo.png";
import brandLight from "./brand/kleague-logo-light.png";
import charging from "./review/charging.webp";
import foul from "./review/foul.jpg";
import goal from "./review/goal.jpg";
import handball from "./review/handball.jpg";
import hero from "./hero/kleague-ball.jpg";

// 이미지 자산 경로
export type Asset = string | { src: string };

// 자산 경로 변환
export const path = (asset: Asset) => typeof asset === "string" ? asset : asset.src;

// 이미지 묶음
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
