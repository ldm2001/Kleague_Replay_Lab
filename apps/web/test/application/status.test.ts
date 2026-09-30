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
    type MediaSnapshot,
    type MediaStatusCommand,
    type MediaStatusStore
} from "@replay/application";
import { mediaView } from "../../src/application/use-cases/status/view";
import { candidateSnapshot, mediaSnapshot } from "../fixtures/status";

// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-08-30T00:00:00.000Z");
// 영상 원자료 시험 입력으로 과거 수동 이력 후보 1개를 가진 분석 원자료 생성
const snapshot = mediaSnapshot();
// 장면 사건 시험 입력으로 종류 코너킥 및 상태 관측완료 및 시작시각 600 및 종료시각 1400 자료 생성
const sceneEvent = {
    kind: "CORNER_KICK",
    status: "OBSERVED",
    startMs: 600,
    endMs: 1400,
    restartMs: 1000,
    evidenceTimestampsMs: [600, 900, 1100, 1400],
    method: "corner-geometry-motion-v1"
} as const;

class StatusDouble implements MediaStatusStore {
    commands: MediaStatusCommand[] = [];

    // 검증용 상태 구성
    async status(command: MediaStatusCommand): Promise<MediaSnapshot | null> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 영상 원자료 반환
        return snapshot;
    }
}

describe("media status", () => {
    it("does not leak private automatic review counts or raw candidates through polling", async () => {
        // 원시 후보와 미평가 인식 장면 및 자동 평가 요약을 가진 처리 산출 원자료 준비
        const pipeline = mediaSnapshot({
            pipelineVersion: "video-baseline-v1",
            candidates: [
                candidateSnapshot(),
                candidateSnapshot({
                    id: "55555555-5555-4555-8555-555555555555",
                    index: 2,
                    category: "CORNER_KICK",
                    sceneEvent
                })
            ],
            automatic: {
                summary: {
                    version: "automatic-review-v1",
                    analysisId: "22222222-2222-4222-8222-222222222222",
                    jobId: "66666666-6666-4666-8666-666666666666",
                    jobRevision: 1,
                    sourceSha256: "a".repeat(64),
                    pipelineVersion: "video-baseline-v1",
                    videoCoverage: "PARTIAL",
                    summaryTruncated: true,
                    evaluatedCount: 0,
                    blockedCount: 1,
                    rows: []
                },
                evidenceBindings: [],
                matchContextValid: false,
                modelProvenance: null
            }
        });
        // 공개 전 내부 화면 모델의 자동 평가 요약과 진단 및 인식 장면 보존 확인
        expect(mediaView(pipeline).analysis).toMatchObject({
            automaticReviewSummary: {
                videoCoverage: "PARTIAL",
                summaryTruncated: true,
                blockedCount: 1
            },
            diagnostics: { rawProposalCount: 1, recognizedEventCount: 1 },
            candidates: [{ index: 2, sceneEvent }]
        });
        // 상태 결과를 출력에 저장
        const output = await status({
            clock: { now: () => NOW },
            repository: { status: async () => pipeline }
        })({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: pipeline.videoAssetId
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

        // 결과의 원자료 내부 화면 모델 기준 구조 일치 확인
        expect(result).toEqual(mediaView(snapshot));
        // 과거 수동 이력 후보가 공개 정책에서 유지됨 확인
        expect(result).toMatchObject({
            videoAssetId: "11111111-1111-4111-8111-111111111111",
            videoStatus: "VALID",
            analysis: {
                analysisId: "22222222-2222-4222-8222-222222222222",
                status: "COMPLETED",
                judgmentStatus: "NOT_EVALUATED",
                candidates: [
                    { id: "44444444-4444-4444-8444-444444444444", index: 1, signalScore: 0.42 }
                ]
            }
        });
        // 결과의 원본 내용 해시 항목 없음 확인
        expect(result).not.toHaveProperty("sourceSha256");
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
