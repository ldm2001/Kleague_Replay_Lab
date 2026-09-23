import { describe, expect, it } from "vitest";
import { result, type AnalysisPayload, type JobResultCommand } from "@replay/application";
import { schema } from "@replay/database";

describe("unclassified shot contract", () => {
    it.each([null, false, true])(
        "preserves replay state %s through result validation",
        async (isReplay) => {
            // 명령목록 시험용 0개 항목 목록 준비
            const commands: JobResultCommand[] = [];
            // 전송자료 시험 입력으로 종류 지정 문자열 및 파이프라인 버전 영상 기준자료 및 한계목록 및 후보목록 자료 생성
            const payload: AnalysisPayload = {
                kind: "ANALYZED",
                pipelineVersion: "video-baseline-v1",
                limitations: ["replay_detection_pending"],
                candidates: [],
                shots: [
                    {
                        index: 0,
                        startMs: 0,
                        endMs: 1000,
                        playbackSpeed: "UNKNOWN",
                        isReplay,
                        cameraAngle: null
                    }
                ]
            };
            // 작업 시험용 결과 준비
            const operation = result({
                clock: { now: () => new Date("2026-09-21T00:00:00Z") },
                hasher: { sha256: async () => new Uint8Array(32) },
                repository: {
                    result: async (command) => {
                        // 명령목록 추가 결과 처리 수행
                        commands.push(command);
                        // 종류 접수완료 자료 반환
                        return { kind: "ACCEPTED" };
                    }
                }
            });
            // 작업 결과의 종류 접수완료 자료 기준 구조 일치 확인
            expect(
                await operation({
                    jobId: "11111111-1111-4111-8111-111111111111",
                    workerId: "test-worker",
                    jobRevision: 1,
                    leaseToken: "lease",
                    payload
                })
            ).toEqual({ kind: "ACCEPTED" });
            // 명령목록 중 선택 항목 전송자료의 전송자료 기준 구조 일치 확인
            expect(commands[0]?.payload).toEqual(payload);
        }
    );

    it("represents unknown replay in the database schema", () => {
        // 스키마 샷목록 재생의 기대값 거짓 일치 확인
        expect(schema.shots.isReplay.notNull).toBe(false);
    });
});
