import { describe, expect, it, vi } from "vitest";
import { result, type AnalysisPayload } from "@replay/application";
import { result as acceptResult, type JobApiDependencies } from "../../src/apis/job";
import { WORKER_PROTOCOL, type SceneEvent } from "@replay/shared-types";

// 장면 사건 시험 입력으로 종류 코너킥 및 상태 관측완료 및 시작시각 600 및 종료시각 1400 자료 생성
const sceneEvent: SceneEvent = {
    kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
    evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};

// 검증용 전송 자료 구성
function payload(value: unknown): AnalysisPayload {
    // 종류 지정 문자열 및 파이프라인 버전 영상 기준자료 및 한계목록 및 샷목록 자료 반환
    return {
        kind: "ANALYZED", pipelineVersion: "video-baseline-v1", limitations: [], shots: [],
        candidates: [{ index: 1, category: "OTHER", startMs: 500, endMs: 1500, anchorMs: 1000,
            confidence: 0.5, cameraSufficiency: "MEDIUM", reasons: [], shotIndices: [],
            sceneEvent: value as SceneEvent,
        }],
    };
}

// 검증용 제출 구성
async function submit(value: unknown) {
    // 저장 호출 여부와 전달 인자를 기록할 모의함수 생성
    const save = vi.fn(async () => ({ kind: "ACCEPTED" as const }));
    // 작업 시험용 결과 준비
    const operation = result({
        clock: { now: () => new Date("2030-01-01T12:00:00.000Z") },
        hasher: { sha256: async () => new Uint8Array([1, 2, 3]) },
        repository: { result: save }
    });
    // 결과 결과를 응답에 저장
    const response = await acceptResult(
        new Request("http://local/internal/jobs/result", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-worker-key": "test-key",
                "x-worker-protocol": WORKER_PROTOCOL
            },
            body: JSON.stringify({
                workerId: "test-worker",
                jobRevision: 1,
                leaseToken: "test-lease",
                payload: payload(value)
            })
        }),
        { jobId: "11111111-1111-4111-8111-111111111111" },
        { key: "test-key", result: operation } as JobApiDependencies
    );
    // 응답 및 저장 자료 반환
    return { response, save };
}

describe("scene event worker API contract", () => {
    it("preserves a bounded corner observation for storage", async () => {
        // 시험자료 결과를 응답 저장에 저장
        const { response, save } = await submit(sceneEvent);
        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 저장의 시험자료 부분객체 결과 인자 전달 확인
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({ payload: payload(sceneEvent) })
        );
    });

    it.each([undefined, null])(
        "accepts legacy payloads without a scene event: %s",
        async (value) => {
            // 시험자료 결과를 응답 저장에 저장
            const { response, save } = await submit(value);
            // 응답 상태의 기대값 200 일치 확인
            expect(response.status).toBe(200);
            // 저장의 한 차례 호출 확인
            expect(save).toHaveBeenCalledOnce();
        }
    );

    it.each([
        { ...sceneEvent, startMs: 499 },
        { ...sceneEvent, endMs: 1501 },
        { ...sceneEvent, restartMs: 600 },
        { ...sceneEvent, restartMs: 1400 },
        { ...sceneEvent, evidenceTimestampsMs: [600, 600, 1100] },
        { ...sceneEvent, evidenceTimestampsMs: [600, 900] },
        { ...sceneEvent, evidenceTimestampsMs: [1000, 1400] },
        { ...sceneEvent, evidenceTimestampsMs: [600, 1401] },
        { ...sceneEvent, method: "unsupported-detector" },
        { ...sceneEvent, kind: "FREE_KICK" }
    ])("rejects malformed scene evidence before storage: %j", async (value) => {
        // 시험자료 결과를 응답 저장에 저장
        const { response, save } = await submit(value);
        // 응답 상태의 기대값 400 일치 확인
        expect(response.status).toBe(400);
        // 저장의 미호출 확인
        expect(save).not.toHaveBeenCalled();
    });
});
