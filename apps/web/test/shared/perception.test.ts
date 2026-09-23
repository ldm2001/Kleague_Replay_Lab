import { describe, expect, it } from "vitest";
import { perceptionRefs, perceptionRunData, type PerceptionRun } from "@replay/shared-types";

// 시험자료 시험용 지정 문자열 반복문자열 결과 준비
const SHA_A = "a".repeat(64);
// 시험자료 시험용 지정 문자열 반복문자열 결과 준비
const SHA_B = "b".repeat(64);

// 검증용 실행 구성
const run = (): PerceptionRun => ({
    schemaVersion: "perception-run-v1",
    sourceSha256: SHA_A,
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
            modelId: "detector",
            revision: "rev-1",
            weightsSha256: "c".repeat(64)
        },
        { component: "role", modelId: "role", revision: "rev-2", weightsSha256: "d".repeat(64) },
        { component: "pose", modelId: "pose", revision: "rev-3", weightsSha256: "e".repeat(64) }
    ],
    artifact: {
        objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${SHA_B}.jsonl.gz`,
        contentType: "application/gzip",
        contentSha256: SHA_B,
        sizeBytes: 1_024
    },
    summary: {
        roleObservationCount: 1,
        poseObservationCount: 1,
        officialCueCount: 1,
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
            reasons: ["method-not-yet-verified"]
        }
    ]
});

describe("perception run contract", () => {
    // 검증용 시청각 실행 구성
    const avRun = (): any => ({
        ...run(),
        schemaVersion: "perception-run-v2",
        audio: {
            version: "audio-observations-v1",
            sourceSha256: SHA_A,
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
    });

    it("accepts v2 audio and preserves the exact v1 shape", () => {
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(run())).toBe(true);
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(avRun())).toBe(true);
        // 시험자료 시험용 깊은복사 결과 준비
        const v1 = structuredClone(run()) as any;
        // 시험자료 음향을 실행 결과 음향 값으로 설정
        v1.audio = avRun().audio;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(v1)).toBe(false);
        // 시험자료 시험용 실행 결과 준비
        const v2 = avRun();
        // 입력 조건 처리 수행
        delete v2.audio;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(v2)).toBe(false);
    });

    it.each([
        [
            "source mismatch",
            (v: any) => {
                // 개별값 음향 원본 해시를 반복문자열 반환값 값으로 설정
                v.audio.sourceSha256 = SHA_B;
            }
        ],
        [
            "unverified speech",
            (v: any) => {
                // 개별값 음향 상태를 지정 문자열 값으로 설정
                v.audio.speechStatus = "ANALYZED";
            }
        ],
        [
            "invalid sample rate",
            (v: any) => {
                // 개별값 음향 원본을 1 부정 조건 값으로 설정
                v.audio.sourceSampleRateHz = -1;
            }
        ],
        [
            "bad signed offset",
            (v: any) => {
                // 개별값 음향 음향 시각을 시험자료로 설정
                v.audio.timeline.audioOffsetMs = Infinity;
            }
        ],
        [
            "bad origin",
            (v: any) => {
                // 개별값 음향 영상을 시험자료로 설정
                v.audio.timeline.videoOriginSeconds = Infinity;
            }
        ],
        [
            "cue outside source",
            (v: any) => {
                // 개별값 음향 단서목록 중 선택 항목 종료시각을 2_100 값으로 설정
                v.audio.cues[0].endMs = 2_100;
            }
        ],
        [
            "short cue",
            (v: any) => {
                // 개별값 음향 단서목록 중 선택 항목 종료시각을 900 값으로 설정
                v.audio.cues[0].endMs = 900;
            }
        ],
        [
            "bad peak",
            (v: any) => {
                // 개별값 음향 단서목록 중 선택 항목을 2개 항목 목록 값으로 설정
                v.audio.cues[0].peakFrequenciesHz = [3_700, 4_500.1];
            }
        ],
        [
            "bad retained count",
            (v: any) => {
                // 개별값 음향 단서 개수를 0 값으로 설정
                v.audio.cueCount = 0;
            }
        ],
        [
            "duplicate cue id",
            (v: any) => {
                // 개별값 음향 단서목록 추가 결과 처리 수행
                v.audio.cues.push(v.audio.cues[0]);
                // 개별값 음향 단서 개수를 2 값으로 설정
                v.audio.cueCount = 2;
            }
        ],
        [
            "duplicate association",
            (v: any) => {
                // 개별값 음향 연결목록 추가 결과 처리 수행
                v.audio.associations.push(v.audio.associations[0]);
            }
        ],
        [
            "empty association evidence",
            (v: any) => {
                // 개별값 음향 연결목록 중 선택 항목 근거 순번목록을 0개 항목 목록 값으로 설정
                v.audio.associations[0].evidenceIndices = [];
            }
        ],
        [
            "unknown cue reference",
            (v: any) => {
                // 개별값 음향 연결목록 중 선택 항목 단서 식별자를 지정 문자열 값으로 설정
                v.audio.associations[0].cueId = "other";
            }
        ],
        [
            "bad status",
            (v: any) => {
                // 개별값 음향 상태를 지정 문자열 값으로 설정
                v.audio.status = "SILENT";
            }
        ]
    ])("rejects v2 %s", (_label, mutate) => {
        // 값 시험용 실행 결과 준비
        const value = avRun();
        // 거부할 자료 형태로 시험 입력 변경
        mutate(value);
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("requires audio failure to make an otherwise complete visual run PARTIAL", () => {
        // 시험자료 시험용 실행 결과 준비
        const failed = avRun();
        // 실행 반환값 음향 상태를 실패 값으로 설정
        failed.audio.status = "FAILED";
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(failed)).toBe(false);
        // 실행 반환값 상태를 부분 값으로 설정
        failed.processingStatus = "PARTIAL";
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(failed)).toBe(true);
    });

    it("distinguishes absent track, unsupported track and zero-decoded available track", () => {
        // 시험자료 시험용 실행 결과 준비
        const absent = avRun();
        // 실행 반환값 음향을 기존 항목 및 상태 지정 문자열 및 원본 빈 값 및 원본 빈 값 자료로 설정
        absent.audio = {
            ...absent.audio,
            status: "ABSENT",
            sourceSampleRateHz: null,
            sourceChannels: null,
            cueCount: 0,
            cues: [],
            associations: [],
            timeline: {
                ...absent.audio.timeline,
                videoOriginSeconds: null,
                audioOffsetMs: null,
                scannedStartMs: null,
                scannedEndMs: null,
                decodedFrameCount: 0
            }
        };
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(absent)).toBe(true);
        // 실행 반환값 음향 개수를 1 값으로 설정
        absent.audio.timeline.decodedFrameCount = 1;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(absent)).toBe(false);

        // 시험자료 시험용 실행 결과 준비
        const unsupported = avRun();
        // 실행 반환값 상태를 부분 값으로 설정
        unsupported.processingStatus = "PARTIAL";
        // 실행 반환값 음향 상태를 지정 문자열 값으로 설정
        unsupported.audio.status = "UNSUPPORTED";
        // 실행 반환값 음향 단서 개수를 0 값으로 설정
        unsupported.audio.cueCount = 0;
        // 실행 반환값 음향 단서목록을 0개 항목 목록 값으로 설정
        unsupported.audio.cues = [];
        // 실행 반환값 음향 연결목록을 0개 항목 목록 값으로 설정
        unsupported.audio.associations = [];
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(unsupported)).toBe(true);
        // 실행 반환값 상태를 완료 값으로 설정
        unsupported.processingStatus = "COMPLETE";
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(unsupported)).toBe(false);

        // 시험자료 시험용 실행 결과 준비
        const delayed = avRun();
        // 실행 반환값 음향 단서 개수를 0 값으로 설정
        delayed.audio.cueCount = 0;
        // 실행 반환값 음향 단서목록을 0개 항목 목록 값으로 설정
        delayed.audio.cues = [];
        // 실행 반환값 음향 연결목록을 0개 항목 목록 값으로 설정
        delayed.audio.associations = [];
        // 객체 결과 처리 수행
        Object.assign(delayed.audio.timeline, {
            scannedStartMs: 2_000,
            scannedEndMs: 2_000,
            decodedFrameCount: 0,
            audioOffsetMs: 3_000
        });
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(delayed)).toBe(true);
    });

    it.each([
        [
            "too many cues",
            (v: any) => {
                // 개별값 음향 단서목록을 배열 변환 결과 값으로 설정
                v.audio.cues = Array.from({ length: 257 }, (_, i) => ({
                    ...v.audio.cues[0],
                    id: `cue-${i}`
                }));
                // 개별값 음향 단서 개수를 257 값으로 설정
                v.audio.cueCount = 257;
            }
        ],
        [
            "too many associations",
            (v: any) => {
                // 개별값 음향 연결목록을 배열 변환 결과 값으로 설정
                v.audio.associations = Array.from({ length: 513 }, (_, i) => ({
                    ...v.audio.associations[0],
                    candidateIndex: i
                }));
            }
        ],
        [
            "too many evidence links",
            (v: any) => {
                // 개별값 음향 연결목록 중 선택 항목 근거 순번목록을 배열 변환 결과 값으로 설정
                v.audio.associations[0].evidenceIndices = Array.from({ length: 17 }, (_, i) => i);
            }
        ],
        [
            "duplicate evidence links",
            (v: any) => {
                // 개별값 음향 연결목록 중 선택 항목 근거 순번목록을 2개 항목 목록 값으로 설정
                v.audio.associations[0].evidenceIndices = [1, 1];
            }
        ],
        [
            "unmarked truncated count",
            (v: any) => {
                // 개별값 음향 단서 개수를 2 값으로 설정
                v.audio.cueCount = 2;
            }
        ],
        [
            "invalid channel count",
            (v: any) => {
                // 개별값 음향 원본을 33 값으로 설정
                v.audio.sourceChannels = 33;
            }
        ],
        [
            "oversized id",
            (v: any) => {
                // 개별값 음향 단서목록 중 선택 항목 식별자를 지정 문자열 반복문자열 결과 값으로 설정
                v.audio.cues[0].id = "x".repeat(97);
            }
        ],
        [
            "oversized reason",
            (v: any) => {
                // 개별값 음향 사유목록을 1개 항목 목록 값으로 설정
                v.audio.reasons = ["x".repeat(129)];
            }
        ]
    ])("rejects bounded audio %s", (_label, mutate) => {
        // 값 시험용 실행 결과 준비
        const value = avRun();
        // 거부할 자료 형태로 시험 입력 변경
        mutate(value);
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("requires a same-candidate CLIP to contain the entire associated cue", () => {
        // 값 시험용 실행 결과 준비
        const value = avRun();
        // 후보목록 시험용 1개 항목 목록 준비
        const candidates = [{ index: 1, startMs: 500, endMs: 1_500 }];
        // 영상조각 시험 입력으로 후보 순번 1 및 종류 및 시작시각 700 및 종료시각 1_100 자료 생성
        const clip = { candidateIndex: 1, kind: "CLIP" as const, startMs: 700, endMs: 1_100 };
        // 시험자료 시험 입력으로 후보 순번 1 및 종류 및 시작시각 900 및 종료시각 900 자료 생성
        const frame = { candidateIndex: 1, kind: "FRAME" as const, startMs: 900, endMs: 900 };
        // 인식 결과의 기대값 참 일치 확인
        expect(perceptionRefs(value, candidates, [frame, clip])).toBe(true);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [frame, { ...clip, endMs: 900 }])).toBe(false);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [frame, { ...clip, kind: "FRAME" }])).toBe(false);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [frame, { ...clip, candidateIndex: 2 }])).toBe(
            false
        );
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, [{ ...candidates[0]!, startMs: 900 }], [frame, clip])).toBe(
            false
        );
        // 값 음향 연결목록 중 선택 항목 근거 순번목록을 0개 항목 목록 값으로 설정
        value.audio.associations[0].evidenceIndices = [];
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [frame, clip])).toBe(false);
    });
    it("accepts the exact bounded v1 shape", () => {
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(run())).toBe(true);
        // 시험자료 시험용 깊은복사 결과 준비
        const largest = structuredClone(run()) as any;
        // 시험자료 산출물 크기 바이트를 128 비교 조건 비교 조건 값으로 설정
        largest.artifact.sizeBytes = 128 * 1_024 * 1_024;
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(largest)).toBe(true);
        // 시험자료 산출물 크기 바이트를 1 값으로 설정
        largest.artifact.sizeBytes += 1;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(largest)).toBe(false);
    });

    it.each([
        [
            "unknown top-level field",
            (value: Record<string, unknown>) => {
                // 값을 참 값으로 설정
                value.extra = true;
            }
        ],
        [
            "missing required field",
            (value: Record<string, unknown>) => {
                // 입력 조건 처리 수행
                delete value.processingStatus;
            }
        ],
        [
            "undefined required field",
            (value: Record<string, unknown>) => {
                // 값 상태를 미정의값 값으로 설정
                value.processingStatus = undefined;
            }
        ],
        [
            "null required field",
            (value: Record<string, unknown>) => {
                // 값 상태를 빈 값 값으로 설정
                value.processingStatus = null;
            }
        ],
        [
            "uppercase source hash",
            (value: Record<string, unknown>) => {
                // 값 원본 해시를 반복문자열 반환값 사례 결과 값으로 설정
                value.sourceSha256 = SHA_A.toUpperCase();
            }
        ],
        [
            "artifact hash/key mismatch",
            (value: Record<string, unknown>) => {
                // 값 산출물 내용 해시를 지정 문자열 반복문자열 결과 값으로 설정
                (value.artifact as Record<string, unknown>).contentSha256 = "f".repeat(64);
            }
        ],
        [
            "duplicate model component",
            (value: Record<string, unknown>) => {
                // 값 중 선택 항목 컴포넌트를 지정 문자열 값으로 설정
                (value.models as Array<Record<string, unknown>>)[1]!.component = "detector";
            }
        ],
        [
            "too many incidents",
            (value: Record<string, unknown>) => {
                // 값 사건목록을 배열 변환 결과 값으로 설정
                value.incidents = Array.from(
                    { length: 129 },
                    () => (value.incidents as unknown[])[0]
                );
                // 값 요약 개수를 129 값으로 설정
                (value.summary as Record<string, unknown>).linkCount = 129;
            }
        ]
    ])("rejects %s", (_name, mutate) => {
        // 값 시험용 깊은복사 결과 준비
        const value = structuredClone(run()) as unknown as Record<string, unknown>;
        // 거부할 자료 형태로 시험 입력 변경
        mutate(value);
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("rejects inconsistent processing counts", () => {
        // 시험자료 시험용 깊은복사 결과 준비
        const partial = structuredClone(run()) as any;
        // 시험자료 상태를 부분 값으로 설정
        partial.processingStatus = "PARTIAL";
        // 시험자료 분석범위를 3 값으로 설정
        partial.coverage.processedSamples = 3;
        // 시험자료 분석범위를 2 값으로 설정
        partial.coverage.failedSamples = 2;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(partial)).toBe(false);

        // 완료 시험용 깊은복사 결과 준비
        const complete = structuredClone(run()) as any;
        // 완료 분석범위를 3 값으로 설정
        complete.coverage.processedSamples = 3;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(complete)).toBe(false);
    });

    it.each([
        { expectedSamples: 0, processedSamples: 0, failedSamples: 0 },
        { expectedSamples: 3, processedSamples: 3, failedSamples: 0 },
        { expectedSamples: 5, processedSamples: 4, failedSamples: 0 }
    ])("rejects zero or miscomputed sample counts %j", (coverage) => {
        // 값 시험용 깊은복사 결과 준비
        const value = structuredClone(run()) as any;
        // 객체 결과 처리 수행
        Object.assign(value.coverage, coverage);
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("accepts independent totals when retained incidents are official-only or truncated", () => {
        // 시험자료 시험용 깊은복사 결과 준비
        const officialOnly = structuredClone(run()) as any;
        // 시험자료 요약 개수를 0 값으로 설정
        officialOnly.summary.linkCount = 0;
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(officialOnly)).toBe(true);

        // 잘림여부 시험용 깊은복사 결과 준비
        const truncated = structuredClone(run()) as any;
        // 잘림여부 요약 잘림여부를 참 값으로 설정
        truncated.summary.truncated = true;
        // 잘림여부 요약 관측 개수를 5_000 값으로 설정
        truncated.summary.roleObservationCount = 5_000;
        // 잘림여부 요약 관측 개수를 4_000 값으로 설정
        truncated.summary.poseObservationCount = 4_000;
        // 잘림여부 요약 단서 개수를 300 값으로 설정
        truncated.summary.officialCueCount = 300;
        // 잘림여부 요약 개수를 2_000 값으로 설정
        truncated.summary.interactionCount = 2_000;
        // 잘림여부 요약 개수를 1_500 값으로 설정
        truncated.summary.linkCount = 1_500;
        // 인식실행자료 결과의 기대값 참 일치 확인
        expect(perceptionRunData(truncated)).toBe(true);
    });

    it("requires continuity ids to be non-negative safe integers", () => {
        // 값 시험용 깊은복사 결과 준비
        const value = structuredClone(run()) as any;
        // 값 사건목록 중 선택 항목 식별자를 1 값으로 설정
        value.incidents[0].continuityId = "continuity-1";
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
        // 값 사건목록 중 선택 항목 식별자를 숫자 성공여부 비교 조건 값으로 설정
        value.incidents[0].continuityId = Number.MAX_SAFE_INTEGER + 1;
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("rejects a run larger than 256 KiB even when every item limit is valid", () => {
        // 값 시험용 깊은복사 결과 준비
        const value = structuredClone(run()) as any;
        // 값 사건목록을 배열 변환 결과 값으로 설정
        value.incidents = Array.from({ length: 128 }, (_, index) => ({
            ...value.incidents[0]!,
            id: `incident-${index}`,
            reasons: Array.from({ length: 32 }, (__, reason) =>
                `${index}-${reason}-`.padEnd(128, "x")
            )
        }));
        // 값 요약 개수를 128 값으로 설정
        value.summary.linkCount = 128;
        // 바이트버퍼 길이 결과의 256 비교 조건 초과 확인
        expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeGreaterThan(256 * 1_024);
        // 인식실행자료 결과의 기대값 거짓 일치 확인
        expect(perceptionRunData(value)).toBe(false);
    });

    it("requires incident references to exist and belong to the same bounded candidate", () => {
        // 값 시험용 실행 결과 준비
        const value = run();
        // 후보목록 시험용 1개 항목 목록 준비
        const candidates = [{ index: 1, startMs: 500, endMs: 1_500 }];
        // 근거 시험용 1개 항목 목록 준비
        const evidence = [{ candidateIndex: 1, startMs: 1_000, endMs: 1_000 }];
        // 인식 결과의 기대값 참 일치 확인
        expect(perceptionRefs(value, candidates, evidence)).toBe(true);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [])).toBe(false);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [{ ...evidence[0]!, candidateIndex: 2 }])).toBe(
            false
        );
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, [{ index: 1, startMs: 700, endMs: 1_500 }], evidence)).toBe(
            false
        );
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, candidates, [{ ...evidence[0]!, startMs: 499 }])).toBe(false);
        // 인식 결과의 기대값 거짓 일치 확인
        expect(perceptionRefs(value, [...candidates, ...candidates], evidence)).toBe(false);
    });
});
