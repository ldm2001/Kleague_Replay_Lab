// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "@replay/application";
import { competitionRules } from "@replay/rule-data";
import { scopeVerdict } from "@replay/rule-engine";
import { VAR_SCOPE_NOT_ASSESSED } from "@replay/shared-types";
import { knownVideoSource } from "../../adapters/sources";
import { analysis as resultFixture } from "../../../test/fixtures/result";
import { ResultView } from "./index";
import { automaticJudgment } from "../../../test/fixtures/automatic";

// 분석 시험용 22222222 2222 4222 8222 222222222222 준비
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
// 화면자료 시험용 결과 시험자료 결과 준비
const view = resultFixture();

// 결과 화면 테스트
describe("ResultView", () => {
    it("keeps automatic pushing and competition VAR scope counts separate", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    ...view,
                    resultPolicy: "COMPLETED_ONLY",
                    evaluatedCount: 1,
                    completedScopeCount: 2,
                    candidates: [{ ...view.candidates[0]!, automaticJudgment: automaticJudgment() }]
                })
            )
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);
        // 화면의 밀기 규정 평가 1건 · 범위 분석 2건 요소의 화면 표시 확인
        expect(
            await screen.findByText("밀기 규정 평가 1건 · VAR 범위 분석 2건")
        ).toBeInTheDocument();
    });
    afterEach(() => {
        // 이전 시험에서 렌더링한 화면 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
    });

    // 요청 분석 조회 확인
    it("loads the requested analysis instead of the latest analysis", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(JSON.stringify(view), { status: 200 })
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(screen.getByRole("heading", { name: "영상 검토 결과" })).toBeInTheDocument()
        );
        // 통신함수의 지정 형식 문자열 및 시험자료 부분객체 결과 인자 전달 확인
        expect(fetch).toHaveBeenCalledWith(
            `/api/analyses/${ANALYSIS}`,
            expect.objectContaining({ cache: "no-store" })
        );
        // 화면의 새 영상 분석 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute(
            "href",
            "/analyze"
        );
        // 화면의 장면 캐러셀 요소의 화면 표시 확인
        expect(screen.getByLabelText("장면 캐러셀")).toBeInTheDocument();
    });

    // 결과 오류 화면 확인
    it("shows a scoped error state when the result cannot be loaded", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(JSON.stringify({ kind: "NOT_FOUND" }), { status: 404 })
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(
                screen.getByRole("heading", { name: "결과를 불러오지 못했습니다" })
            ).toBeInTheDocument()
        );
        // 화면의 분석 페이지로 이동 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "분석 페이지로 이동" })).toHaveAttribute(
            "href",
            "/analyze"
        );
    });

    it("shows results without configuration or fact entry", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(view)));
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);
        // 조건대기 결과 처리 수행
        await waitFor(() => expect(screen.getByText("01 / 03")).toBeInTheDocument());
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        // 화면의 아래에서 장면의 접촉 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText(/아래에서 장면의 접촉/)).not.toBeInTheDocument();
    });

    it("shows the server's observed and applicable counts without recalculating them", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    ...view,
                    filterSummary: {
                        checkedCount: 3,
                        observedCount: 1,
                        applicableCount: 1,
                        undeterminedCount: 1,
                        excludedCount: 0
                    }
                })
            )
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);
        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(screen.getByText(/재개 장면 관찰 1건 · 검토 규정 연결 1건/)).toBeInTheDocument()
        );
        // 화면의 영상에서 추출한 장면과 규정 검토 조건입니다 요소의 화면 표시 확인
        expect(screen.getByText(/영상에서 추출한 장면과 규정 검토 조건입니다/)).toBeInTheDocument();
        // 화면의 화면 변화로 찾은 후보이며 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText(/화면 변화로 찾은 후보이며/)).not.toBeInTheDocument();
    });

    it("keeps older results readable when the new summary counts are absent", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    ...view,
                    filterSummary: { checkedCount: 3, undeterminedCount: 3, excludedCount: 0 }
                })
            )
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);
        // 조건대기 결과 처리 수행
        await waitFor(() =>
            expect(screen.getByText(/재개 장면 관찰 0건 · 검토 규정 연결 0건/)).toBeInTheDocument()
        );
    });

    it("separates recognized scenes from internal proposals and technical diagnostics", async () => {
        // 시험자료 시험 입력으로 기존 항목 및 진단 및 필터 요약 및 후보목록 자료 생성
        const scoped = {
            ...view,
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 1,
                recognizedEventCount: 2,
                supportedEventTypes: ["CORNER_KICK"],
                reasons: ["INCIDENT_UNCLASSIFIED"]
            },
            filterSummary: {
                checkedCount: 42,
                observedCount: 2,
                applicableCount: 0,
                undeterminedCount: 39,
                excludedCount: 1
            },
            candidates: view.candidates.slice(0, 2).map((candidate) => ({
                ...candidate,
                judgment: null,
                sceneEvent: {
                    kind: "CORNER_KICK",
                    status: "OBSERVED",
                    method: "corner-geometry-motion-v1",
                    startMs: candidate.startMs,
                    endMs: candidate.endMs,
                    restartMs: candidate.anchorMs!,
                    evidenceTimestampsMs: [candidate.startMs, candidate.anchorMs!]
                } as const,
                filter: {
                    filterVersion: "pipeline-rules-v3",
                    status: "OBSERVED",
                    situation: "CORNER_KICK",
                    referenceOnly: true,
                    reasonCodes: ["SITUATION_OBSERVED"],
                    missingFields: [],
                    ruleReferences: [],
                    evidenceIds: []
                } as const
            }))
        };
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(scoped)));
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 화면의 인식된 장면 2건 · 파이프라인 처리 결과 요소 처리 수행
        await screen.findByText("인식된 장면 2건 · 파이프라인 처리 결과");
        // 화면의 현재 코너킥 장면 인식 범위 요소의 화면 표시 확인
        expect(screen.getByText("현재 코너킥 장면 인식 범위")).toBeInTheDocument();
        // 진단 시험용 화면의 처리 진단 요소 준비
        const diagnostics = screen.getByRole("region", { name: "처리 진단" });
        // 화면의 사건 종류를 인식하지 못한 내부 후보 39건 요소의 화면 표시 확인
        expect(
            within(diagnostics).getByText("사건 종류를 인식하지 못한 내부 후보 39건")
        ).toBeInTheDocument();
        // 화면의 유효하지 않은 처리 결과 1건 요소의 화면 표시 확인
        expect(within(diagnostics).getByText("유효하지 않은 처리 결과 1건")).toBeInTheDocument();
        // 화면의 근거 부족 39건 판단 보류 39건 규정 필터 확인 42건 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByText(/근거 부족 39건|판단 보류 39건|규정 필터 확인 42건/)
        ).not.toBeInTheDocument();
        // 화면의 정상 플레이 39건 파울 없음 39건 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText(/정상 플레이 39건|파울 없음 39건/)).not.toBeInTheDocument();
        // 화면의 코너킥 장면 요소의 항목 수 2 확인
        expect(screen.getAllByRole("button", { name: /^코너킥 장면/ })).toHaveLength(2);
        // 화면의 장면 인식은 규정 준수나 파울 판정을 의미하지 않습니다 요소의 화면 표시 확인
        expect(
            screen.getByText(/장면 인식은 규정 준수나 파울 판정을 의미하지 않습니다/)
        ).toBeInTheDocument();
    });

    it("states the corner recognition limit when only unclassified internal proposals remain", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    ...view,
                    candidates: [],
                    diagnostics: {
                        rawProposalCount: 39,
                        invalidOutputCount: 0,
                        recognizedEventCount: 0,
                        supportedEventTypes: ["CORNER_KICK"],
                        reasons: ["INCIDENT_UNCLASSIFIED"]
                    },
                    filterSummary: {
                        checkedCount: 39,
                        observedCount: 0,
                        applicableCount: 0,
                        undeterminedCount: 39,
                        excludedCount: 0
                    }
                })
            )
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 화면의 인식된 장면 0건 · 파이프라인 처리 결과 요소 처리 수행
        await screen.findByText("인식된 장면 0건 · 파이프라인 처리 결과");
        // 화면의 인식된 코너킥 장면이 없습니다 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "인식된 코너킥 장면이 없습니다" })
        ).toBeInTheDocument();
        // 화면의 현재 코너킥 장면 인식 범위 요소의 화면 표시 확인
        expect(screen.getByText("현재 코너킥 장면 인식 범위")).toBeInTheDocument();
        // 화면의 사건 종류를 인식하지 못한 내부 후보 39건 요소의 화면 표시 확인
        expect(screen.getByText("사건 종류를 인식하지 못한 내부 후보 39건")).toBeInTheDocument();
        // 화면의 다른 사건이나 파울이 없다는 뜻은 아닙니다 요소의 화면 표시 확인
        expect(screen.getByText(/다른 사건이나 파울이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
        // 화면의 근거 부족 39건 판단 보류 39건 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText(/근거 부족 39건|판단 보류 39건/)).not.toBeInTheDocument();
        // 화면의 후보 장면 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("button", { name: /^후보 장면/ })).not.toBeInTheDocument();
    });

    it("shows only the completed result count and empty state under the completed-only policy", async () => {
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    ...view,
                    resultPolicy: "COMPLETED_ONLY",
                    candidates: [],
                    evaluatedCount: 0,
                    judgmentStatus: "NOT_EVALUATED",
                    diagnostics: {
                        rawProposalCount: 39,
                        invalidOutputCount: 1,
                        recognizedEventCount: 2,
                        supportedEventTypes: ["CORNER_KICK"],
                        reasons: ["INCIDENT_UNCLASSIFIED"]
                    },
                    filterSummary: {
                        checkedCount: 42,
                        observedCount: 2,
                        applicableCount: 0,
                        undeterminedCount: 39,
                        excludedCount: 1
                    }
                })
            )
        );
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 화면의 완료된 분석 결과 0건 요소 처리 수행
        await screen.findByText("완료된 분석 결과 0건");
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
        // 화면의 새 영상 분석 요소의 지정 속성 적용 확인
        expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute(
            "href",
            "/analyze"
        );
        // 화면의 장면 캐러셀 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "장면 캐러셀" })).not.toBeInTheDocument();
        // 화면의 처리 진단 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
        // 화면의 인식된 장면 코너킥 장면 인식 범위 내부 후보 규정 필터 확인 규정 검토 조건 조건 미확인 판단 보류 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByText(
                /인식된 장면|코너킥 장면 인식 범위|내부 후보|규정 필터 확인|규정 검토 조건|조건 미확인|판단 보류/
            )
        ).not.toBeInTheDocument();
        // 화면의 장면 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("button", { name: /장면/ })).not.toBeInTheDocument();
    });

    it("displays the server's completed VAR scope count without treating it as a foul decision count", async () => {
        // 원본 시험용 영상 원본 결과 준비
        const source = knownVideoSource(
            "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857"
        )!;
        // 테스트용 단서와 실제 규정 엔진으로 화면 계약만 검증하며 실제 영상 분석 결과를 모사 범위에서 제외
        const scope = scopeVerdict(
            {
                source,
                startMs: 0,
                endMs: 2000,
                broadcastCue: {
                    kind: "GOAL_GRAPHIC",
                    method: "broadcast-goal-glyphs-v1",
                    startMs: 1000,
                    endMs: 1400,
                    evidenceTimestampsMs: [1000, 1200, 1400]
                },
                evidence: [{ evidenceId: "scope-clip", kind: "CLIP", startMs: 0, endMs: 2000 }]
            },
            competitionRules(source.competition, source.season)
        )!;
        // 적용범위 상태의 기대값 완료 일치 확인
        expect(scope.status).toBe("COMPLETED");
        // 결과 시험 입력으로 기존 항목 및 결과정책 완료 및 완료 적용범위 개수 7 및 평가완료 개수 0 자료 생성
        const result: AnalysisView = {
            ...view,
            resultPolicy: "COMPLETED_ONLY",
            completedScopeCount: 7,
            evaluatedCount: 0,
            judgmentStatus: "NOT_EVALUATED",
            candidates: [{ ...view.candidates[0]!, judgment: null, varScopeEvaluation: scope }],
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 1,
                recognizedEventCount: 2,
                supportedEventTypes: ["GOAL_GRAPHIC"],
                reasons: []
            }
        };
        // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(result)));
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<ResultView analysisId={ANALYSIS} />);

        // 화면의 완료된 범위 분석 7건 요소 처리 수행
        await screen.findByText("완료된 VAR 범위 분석 7건");
        // 화면의 처리 진단 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
        // 화면의 파울 가능성 있음 완료된 분석 결과 1건 인식된 장면 내부 후보 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByText(/파울 가능성 있음|완료된 분석 결과 1건|인식된 장면|내부 후보/)
        ).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it.each([undefined, "COMPLETED_ONLY"])(
        "does not present a failed analysis as an empty successful result (%s)",
        async (resultPolicy) => {
            // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
            vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ...view,
                        resultPolicy,
                        candidates: [],
                        evaluatedCount: 0,
                        judgmentStatus: "NOT_EVALUATED",
                        status: "FAILED",
                        stage: "FAILED",
                        failureCode: "WORKER_ERROR"
                    })
                )
            );
            // 현재 시험자료로 화면 컴포넌트 렌더링
            render(<ResultView analysisId={ANALYSIS} />);

            // 화면의 영상 처리를 완료하지 못했습니다 요소 처리 수행
            await screen.findByRole("heading", { name: "영상 처리를 완료하지 못했습니다" });
            // 화면의 완료된 분석 결과가 없습니다 요소의 화면에 표시되지 않음 확인
            expect(
                screen.queryByRole("heading", { name: "완료된 분석 결과가 없습니다" })
            ).not.toBeInTheDocument();
            // 화면의 탐지된 주요 장면이 없습니다 요소의 화면에 표시되지 않음 확인
            expect(
                screen.queryByRole("heading", { name: "탐지된 주요 장면이 없습니다" })
            ).not.toBeInTheDocument();
            // 화면의 새 영상 분석 요소의 지정 속성 적용 확인
            expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute(
                "href",
                "/analyze"
            );
        }
    );

    // 실제 작업자 → 요청 경로 → 데이터베이스 → 규정 결과를 그대로 렌더링하며 영상 디코딩이나 브라우저 검증은 포함 제외
    it.skipIf(!process.env.REPLAY_FRONTEND_RESULT)(
        "renders the real pipeline result according to its result policy",
        async () => {
            // 실제값 시험용 응답본문 해석 결과 준비
            const actual = JSON.parse(
                readFileSync(process.env.REPLAY_FRONTEND_RESULT!, "utf8")
            ) as AnalysisView;
            // 실제값 결과정책 비교 조건 비교 조건에 따른 처리 경로 분기
            if (actual.resultPolicy === "COMPLETED_ONLY" && (actual.completedScopeCount ?? 0) > 0) {
                // 실제값 후보목록 길이의 1 이상 확인
                expect(actual.candidates.length).toBeGreaterThanOrEqual(1);
                // 실제값 완료 적용범위 개수의 기대값 실제값 후보목록 길이 일치 확인
                expect(actual.completedScopeCount).toBe(actual.candidates.length);
                // 실제값 평가완료 개수의 기대값 0 일치 확인
                expect(actual.evaluatedCount).toBe(0);
                // 결과가 미평가 상태로 유지됨 확인
                expect(actual.judgmentStatus).toBe("NOT_EVALUATED");
                // 실제값의 진단 항목 없음 확인
                expect(actual).not.toHaveProperty("diagnostics");
                // 실제값의 필터 요약 항목 없음 확인
                expect(actual).not.toHaveProperty("filterSummary");
                // 실제값 후보목록의 각 사례 순회
                for (const candidate of actual.candidates) {
                    // 적용범위 시험용 후보 비디오판독범위평가 준비
                    const scope = candidate.varScopeEvaluation!;
                    // 적용범위의 종류 대회 비디오판독 적용범위 및 상태 완료 및 주제 득점관련 및 지정 항목 참 자료의 필드 일치 확인
                    expect(scope).toMatchObject({
                        kind: "COMPETITION_VAR_SCOPE",
                        status: "COMPLETED",
                        topic: "GOAL_RELATED",
                        included: true,
                        provenance: {
                            origin: "VIDEO_CUE_AND_COMPETITION_RULES",
                            evaluatorVersion: "competition-var-scope-v1",
                            cueMethod: "broadcast-goal-glyphs-v1"
                        }
                    });
                    // 원본 시험용 영상 원본 결과 준비
                    const source = knownVideoSource(scope.provenance.sourceSha256);
                    // 원본의 값 존재 확인
                    expect(source).not.toBeNull();
                    // 규정집 시험용 대회 규정목록 결과 준비
                    const book = competitionRules(source!.competition, source!.season)!;
                    // 적용범위의 대회 및 시즌 및 규정 버전 식별자 자료의 필드 일치 확인
                    expect(scope).toMatchObject({
                        competition: source!.competition,
                        season: source!.season,
                        ruleVersionId: book.versionId
                    });
                    // 적용범위 출처정보의 경기 키 및 규정 해시 자료의 필드 일치 확인
                    expect(scope.provenance).toMatchObject({
                        matchKey: source!.matchKey,
                        ruleDocumentSha256: book.source.documentSha256
                    });
                    // 적용범위 미평가항목의 비디오판독 적용범위 기준 구조 일치 확인
                    expect(scope.notAssessed).toEqual(VAR_SCOPE_NOT_ASSESSED);
                    // 적용범위 인용목록 길이의 0 초과 확인
                    expect(scope.citations.length).toBeGreaterThan(0);
                    // 적용범위 인용목록의 각 사례 순회
                    for (const citation of scope.citations) {
                        // 인용의 권한 지정 문자열 및 판본 자료의 필드 일치 확인
                        expect(citation).toMatchObject({
                            authority: "KLEAGUE",
                            edition: source!.season
                        });
                        // 인용 규정 식별자 결과의 기대값 참 일치 확인
                        expect(citation.ruleId.startsWith(`${book.versionId}-`)).toBe(true);
                    }
                    // 적용범위 근거 식별자목록 길이의 0 초과 확인
                    expect(scope.evidenceIds.length).toBeGreaterThan(0);
                    // 적용범위 근거 식별자목록 전체충족 결과의 기대값 참 일치 확인
                    expect(
                        scope.evidenceIds.every((id) =>
                            candidate.evidence?.some(
                                (item) => item.evidenceId === id && item.kind === "CLIP"
                            )
                        )
                    ).toBe(true);
                    // 후보 판정의 빈 값 확인
                    expect(candidate.judgment).toBeNull();
                    // 적용범위의 판정 항목 없음 확인
                    expect(scope).not.toHaveProperty("decision");
                    // 적용범위의 지정 문자열 항목 없음 확인
                    expect(scope).not.toHaveProperty("intervention");
                }
                // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
                vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
                    new Response(JSON.stringify(actual))
                );
                // 현재 시험자료로 화면 컴포넌트 렌더링
                render(<ResultView analysisId={actual.analysisId} />);
                // 화면의 완료된 범위 분석 요소 처리 수행
                await screen.findByText(`완료된 VAR 범위 분석 ${actual.completedScopeCount}건`);
                // 장면 시험용 화면의 득점 관련 장면 요소 준비
                const sceneButtons = screen.getAllByRole("button", { name: /^득점 관련 장면/ });
                // 장면의 항목 수 실제값 후보목록 길이 확인
                expect(sceneButtons).toHaveLength(actual.candidates.length);
                // 장면 중 선택 항목의 지정 속성 적용 확인
                expect(sceneButtons[0]).toHaveAttribute("aria-current", "true");
                // 화면의 득점 관련 검토 범위 요소의 화면 표시 확인
                expect(
                    screen.getByRole("heading", { name: "득점 관련 VAR 검토 범위" })
                ).toBeInTheDocument();
                // 화면의 대회요강의 적용 범주에 해당 요소의 화면 표시 확인
                expect(screen.getByText("대회요강의 적용 범주에 해당")).toBeInTheDocument();
                // 첫결과 적용범위 시험용 실제값 후보목록 중 선택 항목 비디오판독범위평가 준비
                const firstScope = actual.candidates[0]!.varScopeEvaluation!;
                // 화면 문구요소조회 결과의 화면 표시 확인
                expect(screen.getByText(firstScope.explanation)).toBeInTheDocument();
                // 인용목록 시험용 화면의 리그 대회요강 요소 준비
                const citations = screen.getByRole("region", { name: "K리그 대회요강" });
                // 첫결과 적용범위 인용목록의 각 사례 순회
                for (const citation of firstScope.citations) {
                    // 인용목록의 인용 인용스냅샷 문구 표시 확인
                    expect(citations).toHaveTextContent(citation.quoteSnapshot);
                    // 인용목록 요소조회 결과의 값 존재 확인
                    expect(
                        citations.querySelector(`a[href='${citation.sourceUrl}']`)
                    ).not.toBeNull();
                }
                // 화면의 제공된 대회요강의 적용 범주 분석이며 실제 득점 인정· 실시·원심 오류·개입 필요성을 뜻하지 않습니다 요소의 화면 표시 확인
                expect(
                    screen.getByText(
                        "제공된 대회요강의 적용 범주 분석이며 실제 득점 인정·VAR 실시·원심 오류·개입 필요성을 뜻하지 않습니다"
                    )
                ).toBeInTheDocument();
                // 화면의 처리 진단 요소의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
                // 화면의 검토 요소의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("region", { name: "VAR 검토" })).not.toBeInTheDocument();
                // 화면의 조건 미확인 판단 보류 판정 보류 규정 판단 근거 부족 파울 가능성 있음 검토를 실시했습니다 이 실시됐습니다 요소의 화면에 표시되지 않음 확인
                expect(
                    screen.queryByText(
                        /UNVERIFIED|조건 미확인|판단 보류|판정 보류|규정 판단 근거 부족|파울 가능성 있음|VAR 검토를 실시했습니다|VAR이 실시됐습니다/
                    )
                ).not.toBeInTheDocument();
                // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
                // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
                // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
                // 마지막 득점 관련 연속 장면을 선택하고 서버가 연결한 실제 클립 주소를 유지
                fireEvent.click(sceneButtons[sceneButtons.length - 1]!);
                // 장면 중 선택 항목의 지정 속성 적용 확인
                expect(sceneButtons[sceneButtons.length - 1]).toHaveAttribute(
                    "aria-current",
                    "true"
                );
                // 후보 시험용 실제값 후보목록 중 선택 항목 준비
                const lastCandidate = actual.candidates[actual.candidates.length - 1]!;
                // 영상조각 시험용 후보 근거 조회 결과 준비
                const lastClip = lastCandidate.evidence?.find((item) => item.kind === "CLIP");
                // 영상조각의 정의된 값 확인
                expect(lastClip).toBeDefined();
                // 화면의 장면 캐러셀 요소 요소조회 결과의 지정 속성 적용 확인
                expect(
                    screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")
                ).toHaveAttribute(
                    "src",
                    `/api/analyses/${actual.analysisId}/evidence/${lastClip!.evidenceId}`
                );
                // 화면 문구요소조회 결과의 화면 표시 확인
                expect(
                    screen.getByText(lastCandidate.varScopeEvaluation!.explanation)
                ).toBeInTheDocument();
                // 대상 값 반환
                return;
            }
            // 실제값 결과정책 비교 조건에 따른 처리 경로 분기
            if (actual.resultPolicy === "COMPLETED_ONLY") {
                // 실제값 후보목록의 0개 항목 목록 기준 구조 일치 확인
                expect(actual.candidates).toEqual([]);
                // 실제값 평가완료 개수의 기대값 0 일치 확인
                expect(actual.evaluatedCount).toBe(0);
                // 결과가 미평가 상태로 유지됨 확인
                expect(actual.judgmentStatus).toBe("NOT_EVALUATED");
                // 실제값의 진단 항목 없음 확인
                expect(actual).not.toHaveProperty("diagnostics");
                // 실제값의 필터 요약 항목 없음 확인
                expect(actual).not.toHaveProperty("filterSummary");
                // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
                vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
                    new Response(JSON.stringify(actual))
                );
                // 현재 시험자료로 화면 컴포넌트 렌더링
                render(<ResultView analysisId={actual.analysisId} />);
                // 화면의 완료된 분석 결과 0건 요소 처리 수행
                await screen.findByText("완료된 분석 결과 0건");
                // 화면의 완료된 분석 결과가 없습니다 요소의 화면 표시 확인
                expect(
                    screen.getByRole("heading", { name: "완료된 분석 결과가 없습니다" })
                ).toBeInTheDocument();
                // 화면의 파울이 없다는 판정은 아닙니다 요소의 화면 표시 확인
                expect(screen.getByText(/파울이 없다는 판정은 아닙니다/)).toBeInTheDocument();
                // 화면의 새 영상 분석 요소의 지정 속성 적용 확인
                expect(screen.getByRole("link", { name: "새 영상 분석" })).toHaveAttribute(
                    "href",
                    "/analyze"
                );
                // 화면의 장면 요소의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("button", { name: /장면/ })).not.toBeInTheDocument();
                // 화면의 장면 캐러셀 요소의 화면에 표시되지 않음 확인
                expect(
                    screen.queryByRole("region", { name: "장면 캐러셀" })
                ).not.toBeInTheDocument();
                // 화면의 처리 진단 요소의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("region", { name: "처리 진단" })).not.toBeInTheDocument();
                // 화면의 인식된 장면 인식 범위 내부 후보 조건 미확인 판단 보류 판정 보류 요소의 화면에 표시되지 않음 확인
                expect(
                    screen.queryByText(
                        /인식된 장면|인식 범위|내부 후보|조건 미확인|판단 보류|판정 보류/
                    )
                ).not.toBeInTheDocument();
                // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
                // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
                expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
                // 대상 값 반환
                return;
            }
            // 코너킥 순번 시험용 실제값 후보목록 조회 순번 결과 준비
            const cornerIndex = actual.candidates.findIndex(
                (candidate) =>
                    candidate.sceneEvent?.kind === "CORNER_KICK" &&
                    candidate.sceneEvent.status === "OBSERVED"
            );
            // 코너킥 순번의 0 이상 확인
            expect(cornerIndex).toBeGreaterThanOrEqual(0);
            // 코너킥 시험용 실제값 후보목록 중 선택 항목 준비
            const corner = actual.candidates[cornerIndex]!;
            // 영상조각 시험용 코너킥 근거 조회 결과 준비
            const clip = corner.evidence?.find((item) => item.kind === "CLIP");
            // 영상조각의 정의된 값 확인
            expect(clip).toBeDefined();
            // 코너킥 필터의 상태 관측완료 및 참조 참 자료의 필드 일치 확인
            expect(corner.filter).toMatchObject({ status: "OBSERVED", referenceOnly: true });
            // 코너킥 필터 조건목록의 항목 수 4 확인
            expect(corner.filter?.conditions).toHaveLength(4);
            // 시험도구 호출감시 결과 일회응답설정 결과 처리 수행
            vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
                new Response(JSON.stringify(actual))
            );
            // 현재 시험자료로 화면 컴포넌트 렌더링
            render(<ResultView analysisId={actual.analysisId} />);
            // 화면의 코너킥 장면 요소를 코너킥 버튼에 저장
            const cornerButton = await screen.findByRole("button", {
                name: new RegExp(`^코너킥 장면 ${String(cornerIndex + 1).padStart(2, "0")} `)
            });
            // 결과 진입만으로 인식된 장면과 규정 조건이 처음부터 보인다
            expect(cornerButton).toHaveAttribute("aria-current", "true");
            // 화면의 코너킥 장면 요소의 화면 표시 확인
            expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
            // 화면의 적용 판본 미확정 · 참고 규정 요소의 화면 표시 확인
            expect(screen.getByText("적용 판본 미확정 · 참고 규정")).toBeInTheDocument();
            // 조건목록 시험용 화면의 코너킥 검토 조건 요소 준비
            const conditions = screen.getByRole("region", { name: "코너킥 검토 조건" });
            // 화면의 조건 미확인 요소의 항목 수 4 확인
            expect(within(conditions).getAllByText(/조건 미확인/)).toHaveLength(4);
            // 코너킥 필터 조건목록의 각 사례 순회
            for (const condition of corner.filter!.conditions!)
                // 시험자료 결과 문구요소조회 결과의 화면 표시 확인
                expect(within(conditions).getByText(condition.description)).toBeInTheDocument();
            // 화면의 장면 캐러셀 요소 요소조회 결과의 지정 속성 적용 확인
            expect(
                screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")
            ).toHaveAttribute(
                "src",
                `/api/analyses/${actual.analysisId}/evidence/${clip!.evidenceId}`
            );
            // 화면의 파울 가능성 있음 요소의 화면에 표시되지 않음 확인
            expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
            // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
            expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
            // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
            expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
            // 실제값 진단에 따른 처리 경로 분기
            if (actual.diagnostics) {
                // 실제값 진단 인식완료 사건 개수의 기대값 실제값 후보목록 길이 일치 확인
                expect(actual.diagnostics.recognizedEventCount).toBe(actual.candidates.length);
                // 실제값 후보목록 전체충족 결과의 기대값 참 일치 확인
                expect(
                    actual.candidates.every(
                        (candidate) =>
                            candidate.sceneEvent?.kind === "CORNER_KICK" &&
                            candidate.sceneEvent.status === "OBSERVED"
                    )
                ).toBe(true);
                // 화면 역할요소조회 결과의 지정 형식 문자열 문구 표시 확인
                expect(screen.getByRole("status")).toHaveTextContent(
                    `인식된 장면 ${actual.diagnostics.recognizedEventCount}건`
                );
                // 화면의 처리 진단 요소의 지정 형식 문자열 문구 표시 확인
                expect(screen.getByRole("region", { name: "처리 진단" })).toHaveTextContent(
                    `사건 종류를 인식하지 못한 내부 후보 ${actual.diagnostics.rawProposalCount}건`
                );
                // 화면의 근거 부족 판단 보류 규정 필터 확인 요소의 화면에 표시되지 않음 확인
                expect(
                    screen.queryByText(/근거 부족 \d+건|판단 보류 \d+건|규정 필터 확인 \d+건/)
                ).not.toBeInTheDocument();
            }
            // 실제값 후보목록 길이 비교 조건에 따른 처리 경로 분기
            if (actual.candidates.length > 1) {
                // 화면의 이전 장면 다음 장면 요소에 사용자 클릭 이벤트 전달
                fireEvent.click(
                    screen.getByRole("button", {
                        name: cornerIndex > 0 ? "이전 장면" : "다음 장면"
                    })
                );
                // 코너킥 버튼의 지정 속성 미적용 확인
                expect(cornerButton).not.toHaveAttribute("aria-current", "true");
                // 코너킥 버튼에 사용자 클릭 이벤트 전달
                fireEvent.click(cornerButton);
                // 코너킥 버튼의 지정 속성 적용 확인
                expect(cornerButton).toHaveAttribute("aria-current", "true");
                // 화면의 코너킥 장면 요소의 화면 표시 확인
                expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
                // 화면의 장면 캐러셀 요소 요소조회 결과의 지정 속성 적용 확인
                expect(
                    screen.getByRole("region", { name: "장면 캐러셀" }).querySelector("video")
                ).toHaveAttribute(
                    "src",
                    `/api/analyses/${actual.analysisId}/evidence/${clip!.evidenceId}`
                );
            }
        }
    );
});
