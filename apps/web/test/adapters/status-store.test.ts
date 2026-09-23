import { describe, expect, it } from "vitest";
import { StatusStore } from "@replay/adapters";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { judgment } from "../fixtures/result";

// 행목록 시험용 3개 항목 목록 준비
const rows = [
    [{
        video_asset_id: "11111111-1111-4111-8111-111111111111",
        video_status: "VALID",
        validation_error_code: null,
        analysis_id: "22222222-2222-4222-8222-222222222222",
        analysis_status: "CANDIDATES_READY",
        pipeline_version: "video-baseline-v1",
        stage: "SUCCEEDED",
        progress_percent: 100,
        failure_code: null,
        limitations: ["incident_category_classification_pending"],
        has_decisions: false,
    }],
    [{
        candidate_index: 1,
        start_ms: 500,
        end_ms: 1500,
        anchor_ms: 1000,
        signal_score: 0.42,
        camera_sufficiency: "MEDIUM",
        reasons: ["motion-spike"],
    }],
    [{
        id: "55555555-5555-4555-8555-555555555555",
        candidate_index: 1,
        kind: "FRAME",
    }],
];

// 장면 사건 시험 입력으로 종류 코너킥 및 상태 관측완료 및 시작시각 600 및 종료시각 1400 자료 생성
const sceneEvent = {
    kind: "CORNER_KICK", status: "OBSERVED", startMs: 600, endMs: 1400, restartMs: 1000,
    evidenceTimestampsMs: [600, 900, 1100, 1400], method: "corner-geometry-motion-v1",
};
// 상태 명령 시험 입력으로 익명 세션 식별자 33333333 3333 4333 8333 333333333333 및 영상 자산 식별자 11111111 1111 4111 8111 111111111111 및 현재시각 2026 08 00 00 자료 생성
const statusCommand = {
    anonymousSessionId: "33333333-3333-4333-8333-333333333333",
    videoAssetId: "11111111-1111-4111-8111-111111111111", now: "2026-08-30T00:00:00.000Z",
};

// 상태 저장소 테스트
describe("StatusStore", () => {
    it("returns only two recognized events from 41 stored proposals and preserves raw diagnostics", async () => {
        // 후보목록 시험용 배열 변환 결과 준비
        const candidates = Array.from({ length: 41 }, (_, index) => ({
            ...rows[1]![0],
            candidate_index: index + 1,
            category: index < 2 ? "CORNER_KICK" : "OTHER",
            scene_event: index < 2 ? sceneEvent : null
        }));
        // 근거 시험용 후보목록 항목변환 결과 준비
        const evidence = candidates.map((candidate) => ({
            ...rows[2]![0],
            candidate_index: candidate.candidate_index
        }));
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [rows[0], candidates, evidence];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);

        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status(statusCommand);

        // 결과 분석 후보목록 항목변환 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(result?.analysis?.candidates.map((candidate) => candidate.index)).toEqual([1, 2]);
        // 접촉 미관측 및 사건 미분류 및 강도 미관측 및 추적 자료 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(result?.analysis?.diagnostics).toEqual({
            rawProposalCount: 39,
            invalidOutputCount: 0,
            recognizedEventCount: 2,
            supportedEventTypes: ["CORNER_KICK"],
            reasons: [
                "CORNER_ONLY_DETECTOR",
                "UNRECOGNIZED_PROPOSALS",
                "CONTACT_UNOBSERVED",
                "INCIDENT_UNCLASSIFIED",
                "INTENSITY_UNOBSERVED",
                "RULE_CONTEXT_UNVERIFIED",
                "TRACKING_UNAVAILABLE"
            ]
        });
        // 결과 분석 필터 요약의 확인완료 개수 41 및 제외 개수 0 및 미확정 개수 39 및 관측결과 개수 2 자료 기준 구조 일치 확인
        expect(result?.analysis?.filterSummary).toEqual({
            checkedCount: 41,
            excludedCount: 0,
            undeterminedCount: 39,
            observedCount: 2,
            applicableCount: 0
        });
        // 결과 분석 한계목록의 1개 항목 목록 기준 구조 일치 확인
        expect(result?.analysis?.limitations).toEqual(["incident_category_classification_pending"]);
        // 결과 분석 규정의 빈 값 확인
        expect(result?.analysis?.rule).toBeNull();
        // 결과가 미평가 상태로 유지됨 확인
        expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
    });

    it("keeps a valid recognized corner when legal review is undetermined without evidence", async () => {
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [
            rows[0],
            [{ ...rows[1]![0], category: "CORNER_KICK", scene_event: sceneEvent }],
            []
        ];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);

        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status(statusCommand);

        // 결과 분석 후보목록의 항목 수 1 확인
        expect(result?.analysis?.candidates).toHaveLength(1);
        // 근거 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(result?.analysis?.candidates[0]).toMatchObject({
            sceneEvent,
            judgment: null,
            facts: null,
            evidence: [],
            filter: {
                status: "UNDETERMINED",
                reasonCodes: expect.arrayContaining(["EVIDENCE_UNAVAILABLE"]),
                missingFields: expect.arrayContaining(["sceneEvidence"]),
                ruleReferences: []
            }
        });
        // 결과 분석 진단의 원시 후보 개수 0 및 무효 출력 개수 0 및 인식완료 사건 개수 1 및 사건 자료의 필드 일치 확인
        expect(result?.analysis?.diagnostics).toMatchObject({
            rawProposalCount: 0,
            invalidOutputCount: 0,
            recognizedEventCount: 1,
            supportedEventTypes: ["CORNER_KICK"]
        });
        // 결과 분석 필터 요약 미확정 개수의 기대값 1 일치 확인
        expect(result?.analysis?.filterSummary?.undeterminedCount).toBe(1);
    });

    it.each([0, 1])(
        "returns no recognized events and explicit detector limits for %i raw proposals",
        async (rawCount) => {
            // 대기열 시험용 3개 항목 목록 준비
            const queue = [rows[0], rawCount === 0 ? [] : rows[1], rows[2]];
            // 저장소 시험용 상태 저장소 준비
            const repository = new StatusStore({
                db: { execute: async () => queue.shift() ?? [] }
            } as never);

            // 저장소 상태 결과를 결과에 저장
            const result = await repository.status(statusCommand);

            // 결과 분석 후보목록의 0개 항목 목록 기준 구조 일치 확인
            expect(result?.analysis?.candidates).toEqual([]);
            // 결과 분석 진단의 원시 후보 개수 및 무효 출력 개수 0 및 인식완료 사건 개수 0 및 사건 자료의 필드 일치 확인
            expect(result?.analysis?.diagnostics).toMatchObject({
                rawProposalCount: rawCount,
                invalidOutputCount: 0,
                recognizedEventCount: 0,
                supportedEventTypes: ["CORNER_KICK"],
                reasons: expect.arrayContaining(["CORNER_ONLY_DETECTOR"])
            });
            // 결과 분석 진단 사유목록 포함여부 결과의 기대값 원시 개수 비교 조건 일치 확인
            expect(result?.analysis?.diagnostics?.reasons.includes("UNRECOGNIZED_PROPOSALS")).toBe(
                rawCount > 0
            );
            // 결과 분석 한계목록의 1개 항목 목록 기준 구조 일치 확인
            expect(result?.analysis?.limitations).toEqual([
                "incident_category_classification_pending"
            ]);
            // 결과가 미평가 상태로 유지됨 확인
            expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
        }
    );

    it.each([
        { changes: { start_ms: -1 }, code: "INVALID_INTERVAL" },
        { changes: { tracking: { version: "invalid" } }, code: "INVALID_TRACKING" },
        { changes: { scene_event: { ...sceneEvent, endMs: 2000 } }, code: "INVALID_SCENE_EVENT" }
    ])(
        "counts $code outputs once, separately from raw proposals and recognized events",
        async ({ changes, code }) => {
            // 후보목록 시험용 3개 항목 목록 준비
            const candidates = [
                { ...rows[1]![0], category: "CORNER_KICK", scene_event: sceneEvent },
                { ...rows[1]![0], candidate_index: 2, category: "CORNER_KICK" },
                { ...rows[1]![0], candidate_index: 3, scene_event: sceneEvent, ...changes }
            ];
            // 대기열 시험용 3개 항목 목록 준비
            const queue = [rows[0], candidates, rows[2]];
            // 저장소 시험용 상태 저장소 준비
            const repository = new StatusStore({
                db: { execute: async () => queue.shift() ?? [] }
            } as never);

            // 저장소 상태 결과를 결과에 저장
            const result = await repository.status(statusCommand);

            // 결과 분석 후보목록 항목변환 결과의 1개 항목 목록 기준 구조 일치 확인
            expect(result?.analysis?.candidates.map((candidate) => candidate.index)).toEqual([1]);
            // 장면 사건 자료 사용 불가 내용을 포함한 기대 결과 일치 확인
            expect(result?.analysis?.diagnostics).toMatchObject({
                rawProposalCount: 1,
                invalidOutputCount: 1,
                recognizedEventCount: 1,
                reasons: expect.arrayContaining([
                    "CORNER_ONLY_DETECTOR",
                    "UNRECOGNIZED_PROPOSALS",
                    "SCENE_EVENT_UNAVAILABLE",
                    code
                ])
            });
            // 진단 시험용 결과 분석 진단 준비
            const diagnostics = result!.analysis!.diagnostics!;
            // 진단 원시 후보 개수 비교 조건 비교 조건의 기대값 후보목록 길이 일치 확인
            expect(
                diagnostics.rawProposalCount +
                    diagnostics.invalidOutputCount +
                    diagnostics.recognizedEventCount
            ).toBe(candidates.length);
            // 결과 분석 필터 요약의 확인완료 개수 3 및 제외 개수 1 및 미확정 개수 1 및 관측결과 개수 1 자료의 필드 일치 확인
            expect(result?.analysis?.filterSummary).toMatchObject({
                checkedCount: 3,
                excludedCount: 1,
                undeterminedCount: 1,
                observedCount: 1
            });
        }
    );

    it("does not mark an empty recognized result adjudicated because raw proposals have legacy judgments", async () => {
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [
            rows[0],
            [
                {
                    ...rows[1]![0],
                    fact_revision_id: "44444444-4444-4444-8444-444444444444",
                    fact_source: "USER",
                    foul_decision: "NO_FOUL",
                    var_reviewable: false,
                    var_category: "NONE",
                    var_within_time_window: false,
                    var_threshold_met: "NOT_MET",
                    var_intervention: "NO_INTERVENTION",
                    var_window_exception: "NONE",
                    var_review_procedure: "NONE"
                }
            ],
            rows[2]
        ];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);

        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status(statusCommand);

        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(result?.analysis).toMatchObject({
            candidates: [],
            evaluatedCount: 0,
            mode: "VISUAL_CHANGE_BASELINE",
            judgmentStatus: "NOT_EVALUATED",
            diagnostics: { rawProposalCount: 1, invalidOutputCount: 0, recognizedEventCount: 0 }
        });
    });

    it.each([null, undefined])(
        "preserves historical facts, observations and judgments without pipeline version %s",
        async (pipelineVersion) => {
            // 관측 시험 입력으로 지정 항목 기존형식 및 분류 지정 문자열 및 접촉 지정 문자열 및 지정 항목 지정 문자열 자료 생성
            const observation = {
                model: "legacy-model",
                category: "UNKNOWN",
                contact: "UNKNOWN",
                displacement: "uncertain",
                camera: "LOW",
                summary: "기존 관찰 이력",
                timestamps: [600, 900, 1400]
            };
            // 샷목록 시험용 1개 항목 목록 준비
            const shots = [
                { id: "66666666-6666-4666-8666-666666666666", index: 0, startMs: 0, endMs: 2000 }
            ];
            // 대기열 시험용 3개 항목 목록 준비
            const queue = [
                [{ ...rows[0]![0], pipeline_version: pipelineVersion }],
                [
                    {
                        ...rows[1]![0],
                        fact_revision_id: judgment.factRevisionId,
                        fact_snapshot: judgment.facts,
                        fact_source: judgment.source,
                        observation,
                        linked_shots: shots,
                        foul_decision: judgment.decision,
                        var_reviewable: judgment.varAssessment.reviewable,
                        var_category: judgment.varAssessment.category,
                        var_within_time_window: judgment.varAssessment.withinTimeWindow,
                        var_threshold_met: judgment.varAssessment.thresholdMet,
                        var_intervention: judgment.varAssessment.intervention,
                        var_window_exception: judgment.varAssessment.windowException,
                        var_review_procedure: judgment.varAssessment.reviewProcedure
                    }
                ],
                rows[2]
            ];
            // 저장소 시험용 상태 저장소 준비
            const repository = new StatusStore({
                db: { execute: async () => queue.shift() ?? [] }
            } as never);

            // 저장소 상태 결과를 결과에 저장
            const result = await repository.status(statusCommand);

            // 결과 분석의 평가완료 개수 1 및 모드 지정 문자열 및 판정 상태 평가완료 및 후보목록 자료의 필드 일치 확인
            expect(result?.analysis).toMatchObject({
                evaluatedCount: 1,
                mode: "ADJUDICATED",
                judgmentStatus: "EVALUATED",
                candidates: [
                    {
                        index: 1,
                        sceneEvent: null,
                        factRevisionId: judgment.factRevisionId,
                        facts: judgment.facts,
                        observation,
                        shots,
                        judgment: {
                            factRevisionId: judgment.factRevisionId,
                            facts: judgment.facts,
                            source: judgment.source,
                            decision: judgment.decision
                        }
                    }
                ]
            });
            // 결과 분석의 진단 항목 없음 확인
            expect(result?.analysis).not.toHaveProperty("diagnostics");
        }
    );

    it("returns a stored corner observation and its rules conditions without inventing a match edition", async () => {
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [rows[0], [{ ...rows[1]![0], scene_event: sceneEvent }], rows[2]];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);
        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: "11111111-1111-4111-8111-111111111111",
            now: "2026-08-30T00:00:00.000Z"
        });
        // 미검증 조건을 포함한 기대 결과 일치 확인
        expect(result?.analysis?.candidates[0]).toMatchObject({
            sceneEvent,
            judgment: null,
            filter: {
                status: "OBSERVED",
                situation: "CORNER_KICK",
                referenceOnly: true,
                ruleReferences: [],
                conditions: expect.arrayContaining([
                    expect.objectContaining({ code: "CORNER_RESTART", status: "UNVERIFIED" })
                ])
            }
        });
        // 결과 분석 필터 요약의 확인완료 개수 1 및 제외 개수 0 및 미확정 개수 0 및 관측결과 개수 1 자료 기준 구조 일치 확인
        expect(result?.analysis?.filterSummary).toEqual({
            checkedCount: 1,
            excludedCount: 0,
            undeterminedCount: 0,
            observedCount: 1,
            applicableCount: 0
        });
    });
    it("excludes invalid candidates from playback while retaining filter counts", async () => {
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [rows[0], [{ ...rows[1]![0], start_ms: -1 }], rows[2]];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);
        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: "11111111-1111-4111-8111-111111111111",
            now: "2026-08-30T00:00:00.000Z"
        });
        // 결과 분석 후보목록의 0개 항목 목록 기준 구조 일치 확인
        expect(result?.analysis?.candidates).toEqual([]);
        // 결과 분석 필터 요약의 확인완료 개수 1 및 제외 개수 1 및 미확정 개수 0 및 관측결과 개수 0 자료 기준 구조 일치 확인
        expect(result?.analysis?.filterSummary).toEqual({
            checkedCount: 1,
            excludedCount: 1,
            undeterminedCount: 0,
            observedCount: 0,
            applicableCount: 0
        });
    });
    it("selects the stored review scenario rather than a nonexistent category column", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: string[] = [];
        // 대기열 시험용 1개 항목 목록 준비
        const queue = [...rows];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: {
                execute: async (statement: SQL) => {
                    // 질의목록 추가 결과 처리 수행
                    queries.push(new PgDialect().sqlToQuery(statement).sql);
                    // 대기열 선두꺼내기 결과 비교 조건 반환
                    return queue.shift() ?? [];
                }
            }
        } as never);
        // 저장소 상태 결과 처리 수행
        await repository.status({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: "11111111-1111-4111-8111-111111111111",
            now: "2026-08-30T00:00:00.000Z"
        });
        // 질의목록 중 선택 항목의 후보 문구 분류 포함 확인
        expect(queries[1]).toContain("candidate.review_scenario::text as category");
        // 질의목록 중 선택 항목의 후보 분류 미포함 확인
        expect(queries[1]).not.toContain("candidate.category");
    });
    it("keeps processing completed when no football decision is possible", async () => {
        // 대기열 시험용 2개 항목 목록 준비
        const queue = [[{ ...rows[0]![0], analysis_status: "COMPLETED" }], ...rows.slice(1)];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);
        // 저장소 상태 결과를 결과에 저장
        const result = await repository.status({
            anonymousSessionId: "33333333-3333-4333-8333-333333333333",
            videoAssetId: "11111111-1111-4111-8111-111111111111",
            now: "2026-08-30T00:00:00.000Z"
        });
        // 결과 분석 상태의 기대값 완료 일치 확인
        expect(result?.analysis?.status).toBe("COMPLETED");
        // 결과가 미평가 상태로 유지됨 확인
        expect(result?.analysis?.judgmentStatus).toBe("NOT_EVALUATED");
    });
    it("maps an owned media analysis view", async () => {
        // 대기열 시험용 3개 항목 목록 준비
        const queue = [rows[0], [{ ...rows[1]![0], scene_event: sceneEvent }], rows[2]];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);

        // 규정 맥락 미검증 조건을 포함한 기대 결과 일치 확인
        await expect(
            repository.status({
                anonymousSessionId: "33333333-3333-4333-8333-333333333333",
                videoAssetId: "11111111-1111-4111-8111-111111111111",
                now: "2026-08-30T00:00:00.000Z"
            })
        ).resolves.toMatchObject({
            videoStatus: "VALID",
            analysis: {
                status: "CANDIDATES_READY",
                progressPercent: 100,
                candidates: [
                    {
                        index: 1,
                        signalScore: 0.42,
                        filter: {
                            status: "OBSERVED",
                            reasonCodes: expect.arrayContaining([
                                "RULE_CONTEXT_UNVERIFIED",
                                "SITUATION_OBSERVED"
                            ])
                        },
                        evidence: [
                            { evidenceId: "55555555-5555-4555-8555-555555555555", kind: "FRAME" }
                        ]
                    }
                ]
            }
        });
    });

    it("maps an owned evidence object", async () => {
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: {
                execute: async () => [
                    { object_key: "evidence/analysis/job/candidate.mp4", kind: "CLIP" }
                ]
            }
        } as never);

        // 저장소 결과의 객체 키 근거 분석 작업 후보 및 내용 유형 영상 자료 기준 구조 일치 확인
        await expect(
            repository.media({
                anonymousSessionId: "33333333-3333-4333-8333-333333333333",
                analysisId: "22222222-2222-4222-8222-222222222222",
                evidenceId: "55555555-5555-4555-8555-555555555555",
                now: "2026-08-31T00:00:00.000Z"
            })
        ).resolves.toEqual({
            objectKey: "evidence/analysis/job/candidate.mp4",
            contentType: "video/mp4"
        });
    });

    it("maps the latest owned video identifier", async () => {
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => [{ id: "11111111-1111-4111-8111-111111111111" }] }
        } as never);

        // 저장소 최신자료 결과의 기대값 11111111 1111 4111 8111 111111111111 일치 확인
        await expect(
            repository.latest({
                anonymousSessionId: "33333333-3333-4333-8333-333333333333",
                now: "2026-09-01T00:00:00.000Z"
            })
        ).resolves.toBe("11111111-1111-4111-8111-111111111111");
    });

    it("maps an owned analysis directly for the result page", async () => {
        // 대기열 시험용 4개 항목 목록 준비
        const queue = [
            [{ video_asset_id: "11111111-1111-4111-8111-111111111111" }],
            rows[0],
            [{ ...rows[1]![0], scene_event: sceneEvent }],
            rows[2]
        ];
        // 저장소 시험용 상태 저장소 준비
        const repository = new StatusStore({
            db: { execute: async () => queue.shift() ?? [] }
        } as never);

        // 저장소 분석 결과의 분석 식별자 22222222 2222 4222 8222 222222222222 및 후보목록 자료의 필드 일치 확인
        await expect(
            repository.analysis({
                anonymousSessionId: "33333333-3333-4333-8333-333333333333",
                analysisId: "22222222-2222-4222-8222-222222222222",
                now: "2026-09-03T00:00:00.000Z"
            })
        ).resolves.toMatchObject({
            analysisId: "22222222-2222-4222-8222-222222222222",
            candidates: [{ index: 1 }]
        });
    });
});
