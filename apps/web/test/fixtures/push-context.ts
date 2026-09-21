import { observation, type PushContext } from "@replay/shared-types";

// 테스트에서 독립적으로 확인됐다고 명시하는 맥락. 운영 기본값이 아니다.
export const context = (insideOwnPenaltyArea = false): PushContext => ({
  ballInPlay: observation(true, "NORMAL", []),
  onField: observation(true, "NORMAL", []),
  againstOpponent: observation(true, "NORMAL", []),
  offenderRole: observation("ATTACKING_TEAM", "NORMAL", []),
  insideOwnPenaltyArea: observation(insideOwnPenaltyArea, "NORMAL", []),
  disciplinaryContext: observation("NONE", "NORMAL", []),
});
