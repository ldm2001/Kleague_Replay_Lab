import { describe, expect, it } from "vitest";
import { broadcastCueData } from "../../src/shared/var-scope";

// 단서 시험 입력으로 종류 지정 문자열 및 방법 방송 및 시작시각 1000 및 종료시각 1401 자료 생성
const cue = { kind: "GOAL_GRAPHIC", method: "broadcast-goal-glyphs-v1", startMs: 1000,
    endMs: 1401, evidenceTimestampsMs: [1000, 1200, 1400] };

describe("broadcast cue contract", () => {
    it("accepts a supported observed graphic with bounded real times", () => {
        // 방송 단서 자료 결과의 기대값 참 일치 확인
        expect(broadcastCueData(cue, 0, 2000)).toBe(true);
    });
    it.each([
        { kind: "GOAL_AWARDED" }, { method: "model-caption" }, { startMs: -1 }, { endMs: 3000 },
        { endMs: 1000 }, { evidenceTimestampsMs: [1200] }, { evidenceTimestampsMs: [1400, 1200] },
        { evidenceTimestampsMs: [1000, 1000] }, { evidenceTimestampsMs: [999, 1200] },
        { evidenceTimestampsMs: [1000, 1402] }, { evidenceTimestampsMs: [1000, 1000.5] },
    ])("rejects unsupported or inconsistent cue %j", (changes) => {
        // 방송 단서 자료 결과의 기대값 거짓 일치 확인
        expect(broadcastCueData({ ...cue, ...changes }, 0, 2000)).toBe(false);
    });
});
