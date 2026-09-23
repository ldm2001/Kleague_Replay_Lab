// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { pipelineFilter } from "@replay/rule-engine";
import { ruleSet } from "@replay/rule-data";
import type { AnalysisView } from "@replay/application";
import type { VarScopeEvaluation } from "@replay/shared-types";
import { analysis } from "../../../test/fixtures/result";
import { SceneView } from "./index";
import { automaticJudgment } from "../../../test/fixtures/automatic";

// 화면 표시 전용 서버 응답 모형이며 실제 영상 출처 일치나 규정 평가를 검증하지 않음
const completedScope: VarScopeEvaluation = {
    kind: "COMPETITION_VAR_SCOPE",
    status: "COMPLETED",
    topic: "GOAL_RELATED",
    included: true,
    question: "득점 관련 장면이 대회 VAR 적용 범위에 포함되는가?",
    explanation: "대회요강의 득점 관련 범위에 포함됩니다",
    competition: "K리그1",
    season: "2026",
    ruleVersionId: "ui-only-competition-rule",
    citations: [],
    evidenceIds: [],
    notAssessed: [
        "FOUL_DECISION",
        "REFEREE_DECISION_CORRECTNESS",
        "VAR_CHECK_PERFORMED",
        "VAR_INTERVENTION_NECESSITY",
        "REVIEW_TIME_WINDOW",
        "IFAB_EDITION_ADOPTION"
    ],
    provenance: {
        origin: "VIDEO_CUE_AND_COMPETITION_RULES",
        evaluatorVersion: "competition-var-scope-v1",
        sourceSha256: "a".repeat(64),
        matchKey: "ui-only-match",
        sourceUrls: ["https://example.test/ui-only-source"],
        cueMethod: "broadcast-goal-glyphs-v1",
        cueStartMs: 0,
        cueEndMs: 1000,
        ruleDocumentSha256: "b".repeat(64)
    }
};

// 장면 보기 테스트
describe("SceneView", () => {
    it("labels automatic pushing as a rule result rather than a visual change score", () => {
        // 기본자료 시험용 분석 결과 준비
        const base = analysis(1);
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <SceneView
                analysis={{
                    ...base,
                    resultPolicy: "COMPLETED_ONLY",
                    candidates: [
                        {
                            ...base.candidates[0]!,
                            automaticJudgment: automaticJudgment(),
                            signalScore: null
                        }
                    ]
                }}
            />
        );
        // 화면의 밀기 평가 장면 01 요소의 화면 표시 확인
        expect(screen.getByRole("button", { name: /밀기 평가 장면 01/ })).toBeInTheDocument();
        // 화면의 화면 변화 점수이며 파울 확률이 아님 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByLabelText("화면 변화 점수이며 파울 확률이 아님")
        ).not.toBeInTheDocument();
    });
    afterEach(() => {
        // 테스트 문서 구조 정리
        cleanup();
    });

    it("moves one scene with buttons and arrow keys", () => {
        // 장면 캐러셀 렌더링
        render(<SceneView analysis={analysis()} />);
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("01 / 03")).toBeInTheDocument();
        // 다음 장면 버튼 이동
        fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("02 / 03")).toBeInTheDocument();
        // 키보드 다음 장면 이동
        fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowRight" });
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("03 / 03")).toBeInTheDocument();
        // 화면의 다음 장면 요소의 비활성화 상태 확인
        expect(screen.getByRole("button", { name: "다음 장면" })).toBeDisabled();
    });

    it("renders only one video element for the selected scene", () => {
        // 선택 장면 미디어 렌더링
        const { container } = render(<SceneView analysis={analysis()} />);
        // 화면컨테이너 질의 전체 결과의 항목 수 1 확인
        expect(container.querySelectorAll("video")).toHaveLength(1);
    });

    it.each(["legacy", "diagnostic", "completed-only"] as const)(
        "opens the first completed scope before an earlier observed corner (%s)",
        (mode) => {
            // 기본자료 시험용 분석 결과 준비
            const base = analysis(4);
            // 화면자료 시험 입력으로 기존 항목 및 기존 항목 및 기존 항목 및 후보목록 자료 생성
            const view: AnalysisView = {
                ...base,
                ...(mode === "completed-only" ? { resultPolicy: "COMPLETED_ONLY" as const } : {}),
                ...(mode === "diagnostic"
                    ? {
                          diagnostics: {
                              rawProposalCount: 4,
                              invalidOutputCount: 0,
                              recognizedEventCount: 3,
                              supportedEventTypes: ["CORNER_KICK", "GOAL_GRAPHIC"] as const,
                              reasons: []
                          }
                      }
                    : {}),
                candidates: base.candidates.map((candidate, index) =>
                    index === 0
                        ? {
                              ...candidate,
                              sceneEvent: {
                                  kind: "CORNER_KICK",
                                  status: "OBSERVED",
                                  method: "corner-geometry-motion-v1",
                                  startMs: 0,
                                  endMs: 2000,
                                  restartMs: 1000,
                                  evidenceTimestampsMs: [0, 1000]
                              },
                              filter: {
                                  status: "OBSERVED",
                                  situation: "CORNER_KICK",
                                  filterVersion: "pipeline-rules-v3",
                                  reasonCodes: [],
                                  missingFields: [],
                                  ruleReferences: [],
                                  evidenceIds: []
                              }
                          }
                        : index < 3
                          ? {
                                ...candidate,
                                signalScore: 0,
                                varScopeEvaluation: completedScope,
                                filter: {
                                    status: "UNDETERMINED",
                                    filterVersion: "pipeline-rules-v3",
                                    reasonCodes: ["CONTACT_UNOBSERVED"],
                                    missingFields: ["contact"],
                                    ruleReferences: [],
                                    evidenceIds: []
                                }
                            }
                          : candidate
                )
            };
            // 화면컨테이너 시험용 화면렌더링 결과 준비
            const { container, rerender } = render(<SceneView analysis={view} />);

            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("02 / 04")).toBeInTheDocument();
            // 화면의 득점 관련 장면 02 요소의 지정 속성 적용 확인
            expect(screen.getByRole("button", { name: /득점 관련 장면 02/ })).toHaveAttribute(
                "aria-current",
                "true"
            );
            // 화면컨테이너 요소조회 결과의 득점 관련 장면 02 문구 표시 확인
            expect(container.querySelector(".scene-caption")).toHaveTextContent(
                "득점 관련 장면 02"
            );
            // 화면컨테이너 질의 전체 결과의 항목 수 1 확인
            expect(container.querySelectorAll("video")).toHaveLength(1);
            // 영상조각 시험용 화면자료 후보목록 중 선택 항목 근거 조회 결과 준비
            const clip = view.candidates[1]!.evidence!.find((item) => item.kind === "CLIP")!;
            // 화면컨테이너 요소조회 결과의 지정 속성 적용 확인
            expect(container.querySelector("video")).toHaveAttribute(
                "src",
                `/api/analyses/${view.analysisId}/evidence/${clip.evidenceId}`
            );
            // 화면의 장면 캐러셀 요소에 사용자 키 이벤트 전달
            fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowLeft" });
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("01 / 04")).toBeInTheDocument();
            // 화면의 다음 장면 요소에 사용자 클릭 이벤트 전달
            fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("02 / 04")).toBeInTheDocument();
            // 화면의 후보 장면 04 요소에 사용자 클릭 이벤트 전달
            fireEvent.click(screen.getByRole("button", { name: /후보 장면 04/ }));
            // 갱신된 분석 자료로 장면 화면 다시 렌더링
            rerender(<SceneView analysis={{ ...view }} />);
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("04 / 04")).toBeInTheDocument();
        }
    );

    it("names the completed goal-related frame when no clip is available", () => {
        // 기본자료 시험용 분석 결과 준비
        const base = analysis(1);
        // 후보 시험용 기본자료 후보목록 중 선택 항목 준비
        const candidate = base.candidates[0]!;
        // 화면자료 시험 입력으로 기존 항목 및 후보목록 자료 생성
        const view = {
            ...base,
            candidates: [
                {
                    ...candidate,
                    varScopeEvaluation: completedScope,
                    evidence: candidate.evidence!.filter((item) => item.kind === "FRAME")
                }
            ]
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<SceneView analysis={view} />);

        // 화면의 득점 관련 장면 01 핵심 프레임 요소의 화면 표시 확인
        expect(
            screen.getByRole("img", { name: "득점 관련 장면 01 핵심 프레임" })
        ).toBeInTheDocument();
    });

    it.each([null, "ifab-2026-27"])(
        "opens the first recognized corner even when it is not the first row (%s)",
        (versionId) => {
            // 기본자료 시험용 분석 결과 준비
            const base = analysis();
            // 장면 사건 시험용 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 1000 자료 준비
            const sceneEvent = {
                kind: "CORNER_KICK",
                status: "OBSERVED",
                method: "corner-geometry-motion-v1",
                startMs: 1000,
                endMs: 3000,
                restartMs: 2000,
                evidenceTimestampsMs: [1000, 2000, 2500]
            } as const;
            // 코너킥 시험 입력으로 기존 항목 및 장면 사건 자료 생성
            const corner = { ...base.candidates[1]!, sceneEvent };
            // 필터 시험용 파이프라인 필터 결과 준비
            const filter = pipelineFilter(
                { ...corner, category: "OTHER", evidenceIds: ["corner-frame"] },
                versionId ? ruleSet(versionId) : null
            );
            // 화면자료 시험 입력으로 기존 항목 및 후보목록 자료 생성
            const view = {
                ...base,
                candidates: [base.candidates[0]!, { ...corner, filter }, base.candidates[2]!]
            };
            // 화면컨테이너 시험용 화면렌더링 결과 준비
            const { container, rerender } = render(<SceneView analysis={view} />);
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("02 / 03")).toBeInTheDocument();
            // 화면의 코너킥 장면 02 요소의 지정 속성 적용 확인
            expect(screen.getByRole("button", { name: /코너킥 장면 02/ })).toHaveAttribute(
                "aria-current",
                "true"
            );
            // 화면의 코너킥 장면 요소의 화면 표시 확인
            expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
            // 화면컨테이너 요소조회 결과의 코너킥 장면 02 문구 표시 확인
            expect(container.querySelector(".scene-caption")).toHaveTextContent("코너킥 장면 02");
            // 화면의 장면 캐러셀 요소에 사용자 키 이벤트 전달
            fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowLeft" });
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("01 / 03")).toBeInTheDocument();
            // 화면의 다음 장면 요소에 사용자 클릭 이벤트 전달
            fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("02 / 03")).toBeInTheDocument();
            // 화면의 후보 장면 03 요소에 사용자 클릭 이벤트 전달
            fireEvent.click(screen.getByRole("button", { name: /후보 장면 03/ }));
            // 갱신된 분석 자료로 장면 화면 다시 렌더링
            rerender(<SceneView analysis={{ ...view }} />);
            // 화면 문구요소조회 결과의 화면 표시 확인
            expect(screen.getByText("03 / 03")).toBeInTheDocument();
        }
    );

    it("names the recognized corner frame when no clip is available", () => {
        // 기본자료 시험용 분석 결과 준비
        const base = analysis(1);
        // 코너킥 시험용 기본자료 후보목록 중 선택 항목 준비
        const corner = base.candidates[0]!;
        // 화면자료 시험 입력으로 기존 항목 및 후보목록 자료 생성
        const view = {
            ...base,
            candidates: [
                {
                    ...corner,
                    evidence: corner.evidence!.filter((item) => item.kind === "FRAME"),
                    sceneEvent: {
                        kind: "CORNER_KICK",
                        status: "OBSERVED",
                        method: "corner-geometry-motion-v1",
                        startMs: 0,
                        endMs: 2000,
                        restartMs: 1000,
                        evidenceTimestampsMs: [0, 1000]
                    } as const,
                    filter: {
                        status: "OBSERVED",
                        situation: "CORNER_KICK",
                        referenceOnly: true,
                        filterVersion: "pipeline-rules-v3",
                        reasonCodes: [],
                        missingFields: [],
                        ruleReferences: [],
                        evidenceIds: []
                    } as const
                }
            ]
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<SceneView analysis={view} />);
        // 화면의 코너킥 장면 01 핵심 프레임 요소의 화면 표시 확인
        expect(screen.getByRole("img", { name: "코너킥 장면 01 핵심 프레임" })).toBeInTheDocument();
    });

    it("limits the scoped empty state to corner recognition without declaring no foul", () => {
        // 시험자료 시험 입력으로 기존 항목 및 진단 자료 생성
        const scoped = {
            ...analysis(0),
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 0,
                recognizedEventCount: 0,
                supportedEventTypes: ["CORNER_KICK"] as const,
                reasons: ["INCIDENT_UNCLASSIFIED"]
            }
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<SceneView analysis={scoped} />);
        // 화면의 인식된 코너킥 장면이 없습니다 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "인식된 코너킥 장면이 없습니다" })
        ).toBeInTheDocument();
        // 화면의 다른 사건이나 파울이 없다는 뜻은 아닙니다 요소의 화면 표시 확인
        expect(screen.getByText(/다른 사건이나 파울이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
        // 화면의 탐지된 주요 장면이 없습니다 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("탐지된 주요 장면이 없습니다")).not.toBeInTheDocument();
    });

    it("explains that no completed result is not a no-foul judgment", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <SceneView
                analysis={{
                    ...analysis(0),
                    resultPolicy: "COMPLETED_ONLY",
                    evaluatedCount: 0,
                    judgmentStatus: "NOT_EVALUATED"
                }}
            />
        );
        // 화면의 완료된 분석 결과가 없습니다 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "완료된 분석 결과가 없습니다" })
        ).toBeInTheDocument();
        // 화면의 이번 영상에서 규정 평가를 완료한 장면이 없습니다 파울이 없다는 판정은 아닙니다 요소의 화면 표시 확인
        expect(
            screen.getByText(
                "이번 영상에서 규정 평가를 완료한 장면이 없습니다. 파울이 없다는 판정은 아닙니다"
            )
        ).toBeInTheDocument();
        // 화면의 장면 캐러셀 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "장면 캐러셀" })).not.toBeInTheDocument();
        // 화면의 인식 범위 규정 판단 근거 부족 조건 미확인 판단 보류 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByText(/인식 범위|규정 판단 근거 부족|조건 미확인|판단 보류/)
        ).not.toBeInTheDocument();
    });

    it.each([
        { status: "FAILED" },
        { stage: "FAILED" },
        { failureCode: "VIDEO_PROCESSING_FAILED" }
    ])("keeps completed-only processing failures distinct from empty results: %j", (failure) => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <SceneView analysis={{ ...analysis(0), resultPolicy: "COMPLETED_ONLY", ...failure }} />
        );
        // 화면의 영상 처리를 완료하지 못했습니다 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "영상 처리를 완료하지 못했습니다" })
        ).toBeInTheDocument();
        // 화면의 처리 오류로 완료된 분석 결과를 제공할 수 없습니다 파울이 없다는 판정은 아닙니다 요소의 화면 표시 확인
        expect(
            screen.getByText(
                "처리 오류로 완료된 분석 결과를 제공할 수 없습니다. 파울이 없다는 판정은 아닙니다"
            )
        ).toBeInTheDocument();
        // 화면의 완료된 분석 결과가 없습니다 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByRole("heading", { name: "완료된 분석 결과가 없습니다" })
        ).not.toBeInTheDocument();
    });

    it("shows processing failure before any result policy has been assigned", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <SceneView
                analysis={{
                    ...analysis(0),
                    status: "FAILED",
                    stage: "FAILED",
                    failureCode: "WORKER_ERROR"
                }}
            />
        );
        // 화면의 영상 처리를 완료하지 못했습니다 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "영상 처리를 완료하지 못했습니다" })
        ).toBeInTheDocument();
        // 화면의 탐지된 주요 장면이 없습니다 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByRole("heading", { name: "탐지된 주요 장면이 없습니다" })
        ).not.toBeInTheDocument();
    });

    it("opens the first scoped recognized corner even when its video evidence is unavailable", () => {
        // 기본자료 시험용 분석 결과 준비
        const base = analysis(2);
        // 시험자료 시험 입력으로 기존 항목 및 진단 및 후보목록 자료 생성
        const scoped = {
            ...base,
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 0,
                recognizedEventCount: 2,
                supportedEventTypes: ["CORNER_KICK"] as const,
                reasons: ["INCIDENT_UNCLASSIFIED"]
            },
            candidates: base.candidates.map((candidate, index) => ({
                ...candidate,
                judgment: null,
                evidence: index === 0 ? [] : (candidate.evidence ?? []),
                sceneEvent: {
                    kind: "CORNER_KICK",
                    status: "OBSERVED",
                    method: "corner-geometry-motion-v1",
                    startMs: candidate.startMs,
                    endMs: candidate.endMs,
                    restartMs: candidate.anchorMs!,
                    evidenceTimestampsMs: [candidate.startMs, candidate.anchorMs!]
                } as const,
                filter:
                    index === 0
                        ? ({
                              filterVersion: "pipeline-rules-v3",
                              status: "UNDETERMINED",
                              reasonCodes: ["EVIDENCE_UNAVAILABLE"],
                              missingFields: ["evidence"],
                              ruleReferences: [],
                              evidenceIds: []
                          } as const)
                        : ({
                              filterVersion: "pipeline-rules-v3",
                              status: "OBSERVED",
                              situation: "CORNER_KICK",
                              reasonCodes: ["SITUATION_OBSERVED"],
                              missingFields: [],
                              ruleReferences: [],
                              evidenceIds: []
                          } as const)
            }))
        };
        // 화면컨테이너 시험용 화면렌더링 결과 준비
        const { container } = render(<SceneView analysis={scoped} />);
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("01 / 02")).toBeInTheDocument();
        // 화면의 코너킥 장면 01 요소의 지정 속성 적용 확인
        expect(screen.getByRole("button", { name: /코너킥 장면 01/ })).toHaveAttribute(
            "aria-current",
            "true"
        );
        // 화면컨테이너 요소조회 결과의 영상 근거 제공 불가 문구 표시 확인
        expect(container.querySelector(".scene-media")).toHaveTextContent("영상 근거 제공 불가");
        // 화면의 영상 준비 중 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("영상 준비 중")).not.toBeInTheDocument();
        // 화면의 다음 장면 요소에 사용자 클릭 이벤트 전달
        fireEvent.click(screen.getByRole("button", { name: "다음 장면" }));
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("02 / 02")).toBeInTheDocument();
        // 화면컨테이너 요소조회 결과의 화면 표시 확인
        expect(container.querySelector("video")).toBeInTheDocument();
        // 화면의 장면 캐러셀 요소에 사용자 키 이벤트 전달
        fireEvent.keyDown(screen.getByLabelText("장면 캐러셀"), { key: "ArrowLeft" });
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText("01 / 02")).toBeInTheDocument();
        // 화면컨테이너 요소조회 결과의 영상 근거 제공 불가 문구 표시 확인
        expect(container.querySelector(".scene-media")).toHaveTextContent("영상 근거 제공 불가");
    });
});
