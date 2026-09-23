// 상태 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
    asset,
    latest,
    status,
    type Clock,
    type EvidenceMedia,
    type EvidenceMediaCommand,
    type EvidenceMediaStore,
    type LatestMediaCommand,
    type LatestMediaStore,
    type MediaStatusCommand,
    type MediaStatusStore,
    type MediaView
} from "@replay/application";

// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-08-30T00:00:00.000Z");
// 화면자료 시험 입력으로 영상 자산 식별자 11111111 1111 4111 8111 111111111111 및 영상 상태 유효 및 오류객체 코드 빈 값 및 분석 자료 생성
const view: MediaView = {
    videoAssetId: "11111111-1111-4111-8111-111111111111",
    videoStatus: "VALID",
    validationErrorCode: null,
    analysis: {
        analysisId: "22222222-2222-4222-8222-222222222222",
        mode: "VISUAL_CHANGE_BASELINE",
        judgmentStatus: "NOT_EVALUATED",
        status: "COMPLETED",
        stage: "SUCCEEDED",
        progressPercent: 100,
        failureCode: null,
        limitations: ["incident_category_classification_pending"],
        candidates: [{
            id: "44444444-4444-4444-8444-444444444444",
            index: 1,
            startMs: 500,
            endMs: 1500,
            anchorMs: 1000,
            signalScore: 0.42,
            cameraSufficiency: "MEDIUM",
            reasons: ["motion-spike"],
        }],
    },
};

class StatusDouble implements MediaStatusStore {
    commands: MediaStatusCommand[] = [];

    // 검증용 상태 구성
    async status(command: MediaStatusCommand): Promise<MediaView | null> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 화면자료 반환
        return view;
    }
}

describe("media status", () => {
    it("does not leak private automatic review counts or raw candidates through polling", async () => {
        // 상태 결과를 출력에 저장
        const output = await status({
            clock: { now: () => NOW },
            repository: {
                status: async () => ({
                    ...view,
                    analysis: {
                        ...view.analysis!,
                        automaticReviewSummary: {
                            videoCoverage: "PARTIAL",
                            summaryTruncated: true,
                            checkedCount: 1,
                            completedCount: 0,
                            blockedCount: 1
                        },
                        diagnostics: {
                            rawProposalCount: 1,
                            invalidOutputCount: 0,
                            recognizedEventCount: 0,
                            supportedEventTypes: [],
                            reasons: []
                        }
                    }
                })
            }
        })({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: view.videoAssetId
        });
        // 출력의 분석 자료의 필드 일치 확인
        expect(output).toMatchObject({ analysis: { candidates: [], evaluatedCount: 0 } });
        // 출력의 분석 자동평가 요약 항목 없음 확인
        expect(output).not.toHaveProperty("analysis.automaticReviewSummary");
        // 출력의 분석 진단 항목 없음 확인
        expect(output).not.toHaveProperty("analysis.diagnostics");
    });
    it("loads an owned video and analysis view", async () => {
        // 저장소 시험용 상태 준비
        const repository = new StatusDouble();
        // 상태 결과를 결과에 저장
        const result = await status({ clock: { now: () => NOW } satisfies Clock, repository })({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: "11111111-1111-4111-8111-111111111111"
        });

        // 결과의 화면자료 기준 구조 일치 확인
        expect(result).toEqual(view);
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            {
                anonymousSessionId: "33333333-3333-4333-8333-333333333333",
                videoAssetId: "11111111-1111-4111-8111-111111111111",
                now: NOW.toISOString()
            }
        ]);
    });

    it("rejects malformed ownership identifiers", async () => {
        // 저장소 시험용 상태 준비
        const repository = new StatusDouble();
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            status({ clock: { now: () => NOW }, repository })({
                anonymousSessionId: "bad",
                videoAssetId: "11111111-1111-4111-8111-111111111111"
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it("loads an owned evidence object reference", async () => {
        // 명령목록 시험용 0개 항목 목록 준비
        const commands: EvidenceMediaCommand[] = [];
        // 저장소 시험 입력으로 지정 항목 자료 생성
        const repository: EvidenceMediaStore = {
            media: async (command) => {
                // 명령목록 추가 결과 처리 수행
                commands.push(command);
                // 입력 조건 반환
                return {
                    objectKey: "evidence/analysis/job/candidate-0001.jpg",
                    contentType: "image/jpeg"
                } satisfies EvidenceMedia;
            }
        };
        // 자산 결과를 결과에 저장
        const result = await asset({ clock: { now: () => NOW }, repository })({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            analysisId: "22222222-2222-4222-8222-222222222222",
            evidenceId: "55555555-5555-4555-8555-555555555555"
        });

        // 결과의 객체 키 근거 분석 작업 후보 0001 및 내용 유형 지정 문자열 자료 기준 구조 일치 확인
        expect(result).toEqual({
            objectKey: "evidence/analysis/job/candidate-0001.jpg",
            contentType: "image/jpeg"
        });
        // 명령목록의 항목 수 1 확인
        expect(commands).toHaveLength(1);
    });

    it("loads the latest owned video identifier", async () => {
        // 명령목록 시험용 0개 항목 목록 준비
        const commands: LatestMediaCommand[] = [];
        // 저장소 시험 입력으로 최신자료 자료 생성
        const repository: LatestMediaStore = {
            latest: async (command) => {
                // 명령목록 추가 결과 처리 수행
                commands.push(command);
                // 11111111 1111 4111 8111 111111111111 반환
                return "11111111-1111-4111-8111-111111111111";
            }
        };

        // 최신자료 결과의 영상 자산 식별자 11111111 1111 4111 8111 111111111111 자료 기준 구조 일치 확인
        await expect(
            latest({ clock: { now: () => NOW }, repository })({
                anonymousSessionId: "33333333-3333-4333-8333-333333333333"
            })
        ).resolves.toEqual({ videoAssetId: "11111111-1111-4111-8111-111111111111" });
        // 명령목록의 항목 수 1 확인
        expect(commands).toHaveLength(1);
    });
});
