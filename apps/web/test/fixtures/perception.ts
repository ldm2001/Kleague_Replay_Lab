import type { AnalysisPayload } from "@replay/application";

// 인식 원본 해시 시험용 지정 문자열 반복문자열 결과 준비
export const PERCEPTION_SOURCE_SHA256 = "a".repeat(64);
// 인식 산출물 해시 시험용 지정 문자열 반복문자열 결과 준비
export const PERCEPTION_ARTIFACT_SHA256 = "b".repeat(64);
// 인식 근거 해시 시험용 지정 문자열 반복문자열 결과 준비
export const PERCEPTION_EVIDENCE_SHA256 = "c".repeat(64);
// 인식 분석 식별자 시험용 22222222 2222 4222 8222 222222222222 준비
export const PERCEPTION_ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";
// 인식 작업 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
export const PERCEPTION_JOB_ID = "11111111-1111-4111-8111-111111111111";

// 검증용 인식 자료 구성
export const perceptionPayload = (): AnalysisPayload => ({
    kind: "ANALYZED",
    pipelineVersion: "video-local-observers-v1",
    limitations: [],
    shots: [
        {
            index: 0,
            startMs: 0,
            endMs: 2_000,
            playbackSpeed: "NORMAL",
            isReplay: false,
            cameraAngle: null
        }
    ],
    candidates: [
        {
            index: 1,
            category: "OTHER",
            startMs: 500,
            endMs: 1_500,
            anchorMs: 1_000,
            confidence: 0.5,
            cameraSufficiency: "MEDIUM",
            reasons: ["motion-spike"],
            shotIndices: [0]
        }
    ],
    evidence: [
        {
            candidateIndex: 1,
            kind: "FRAME",
            objectKey: `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`,
            contentSha256: PERCEPTION_EVIDENCE_SHA256,
            startMs: 1_000,
            endMs: 1_000,
            width: 1_920,
            height: 1_080
        }
    ],
    perception: {
        schemaVersion: "perception-run-v1",
        sourceSha256: PERCEPTION_SOURCE_SHA256,
        // 예정된 표본 처리 완료 표시이며 파울 판정 완료와 별개
        processingStatus: "COMPLETE",
        // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
        coverage: {
            startMs: 0,
            endMs: 2_000,
            sampleIntervalMs: 500,
            // 누락 여부 비교에 사용할 예정 표본 수 설정
            expectedSamples: 4,
            // 실제로 처리한 표본 수 설정이며 판정 사건 수와 구분
            processedSamples: 4,
            // 처리에 실패한 표본 수 설정
            failedSamples: 0
        },
        // 모델 출처와 고정된 개정번호 및 가중치 해시 대조용 목록 구성
        models: [
            {
                component: "detector",
                modelId: "PekingU/rtdetr_r18vd",
                revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753",
                weightsSha256: "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093"
            },
            {
                component: "role",
                modelId: "martinjolif/yolo-football-player-detection",
                revision: "5e83fafa8d564243001ce8e063612a618a138fbe",
                weightsSha256: "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd"
            },
            {
                component: "pose",
                modelId: "usyd-community/vitpose-plus-small",
                revision: "0c30b6534bb621af0162b481176742577264e36e",
                weightsSha256: "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9"
            }
        ],
        artifact: {
            objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`,
            contentType: "application/gzip",
            contentSha256: PERCEPTION_ARTIFACT_SHA256,
            sizeBytes: 1_024
        },
        summary: {
            roleObservationCount: 1,
            poseObservationCount: 1,
            officialCueCount: 0,
            interactionCount: 1,
            linkCount: 1,
            truncated: false,
            reasons: []
        },
        // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
        incidents: [
            {
                id: "incident-1",
                candidateIndex: 1,
                continuityId: 1,
                startMs: 600,
                endMs: 1_400,
                // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                evidenceIndices: [0],
                // 심판 역할을 알 수 없는 관측 상태 보존
                officialRole: "UNKNOWN",
                // 심판 신호를 알 수 없는 관측 상태 보존
                signal: "UNKNOWN",
                // 접촉 미검증 상태이며 실제 접촉 사실로 채택하지 않음
                contact: "UNVERIFIED",
                // 원심을 알 수 없는 상태이며 판정 내용을 추정하지 않음
                originalDecision: "UNKNOWN",
                // 재개 미검증 상태이며 재개 사실로 채택하지 않음
                restart: "UNVERIFIED",
                reasons: ["method-not-verified"]
            }
        ]
    }
});

// 검증용 시청각 인식 자료 구성
export const avPerceptionPayload = (): AnalysisPayload => {
    // 기존형식 시험용 인식전송자료 결과 준비
    const legacy = perceptionPayload();
    // 기존 항목 및 파이프라인 버전 영상 로컬자료 및 근거 및 인식 자료 반환
    return {
        ...legacy,
        pipelineVersion: "video-local-observers-av-v1",
        evidence: [
            ...(legacy.evidence ?? []),
            {
                candidateIndex: 1,
                kind: "CLIP",
                objectKey: `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.mp4`,
                contentSha256: "d".repeat(64),
                startMs: 500,
                endMs: 1_500,
                width: 1_920,
                height: 1_080
            }
        ],
        perception: {
            ...legacy.perception!,
            schemaVersion: "perception-run-v2",
            audio: {
                version: "audio-observations-v1",
                sourceSha256: PERCEPTION_SOURCE_SHA256,
                status: "COMPLETE",
                method: "spectral-multitone-v1",
                speechStatus: "NOT_ANALYZED",
                sourceSampleRateHz: 48_000,
                sourceChannels: 2,
                timeline: {
                    videoOriginSeconds: 0,
                    audioOffsetMs: 0,
                    scannedStartMs: 0,
                    scannedEndMs: 2_000,
                    decodedFrameCount: 20,
                    frameDurationMs: 100,
                    gapPolicy: "PRESERVED_WITH_SYNTHETIC_SILENCE"
                },
                cueCount: 1,
                cues: [
                    {
                        id: "cue-1",
                        startMs: 800,
                        endMs: 1_000,
                        peakFrequenciesHz: [3_700, 4_100],
                        frameCount: 2
                    }
                ],
                associations: [
                    {
                        cueId: "cue-1",
                        candidateIndex: 1,
                        // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
                        evidenceIndices: [1],
                        relation: "TEMPORAL_OVERLAP_ONLY"
                    }
                ],
                truncated: false,
                reasons: []
            }
        }
    };
};
