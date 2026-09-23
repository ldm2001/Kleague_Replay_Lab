// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { scopeVerdict, pipelineFilter } from "@replay/rule-engine";
import { competitionRules, ruleSet } from "@replay/rule-data";
import { knownVideoSource } from "../../adapters/sources";
import { analysis, candidate, judgment } from "../../../test/fixtures/result";
import { RulePanel } from "./index";
import { automaticJudgment } from "../../../test/fixtures/automatic";

describe("RulePanel", () => {
    it("shows a completed automatic pushing answer without claiming overall correctness or requesting facts", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <RulePanel
                analysis={analysis()}
                candidate={{ ...candidate(0), automaticJudgment: automaticJudgment() }}
            />
        );
        // 화면의 밀기 규정 평가 완료 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "밀기 규정 평가 완료" })).toBeInTheDocument();
        // 화면의 직접 프리킥 요소의 화면 표시 확인
        expect(screen.getByText("직접 프리킥")).toBeInTheDocument();
        // 화면의 다른 파울 유형과 원심의 정확성 요소의 화면 표시 확인
        expect(screen.getByText(/다른 파울 유형과 원심의 정확성/)).toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        // 화면의 규정 판단 근거 부족 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
    });
    it("shows unknown contact and an explicit missing-facts explanation", () => {
        // 시험자료 시험 입력으로 기존 항목 및 사유 자료 생성
        const unknown = {
            ...structuredClone(judgment),
            inconclusiveReason: "FACTS_UNDETERMINED" as const
        };
        // 시험자료 사실 추가 접촉감지여부 값을 빈 값 값으로 설정
        unknown.facts.push.contactDetected.value = null;
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<RulePanel analysis={analysis()} candidate={candidate(1, unknown)} />);
        // 화면의 접촉 요소 요소의 미확인 문구 표시 확인
        expect(screen.getByText("접촉").nextElementSibling).toHaveTextContent("미확인");
        // 화면의 판단에 필요한 사실이 확인되지 않음 요소의 화면 표시 확인
        expect(screen.getByText("판단에 필요한 사실이 확인되지 않음")).toBeInTheDocument();
    });
    afterEach(() => {
        // 테스트 문서 구조 정리
        cleanup();
    });

    it("shows a pending state without inventing a decision", () => {
        // 사실 대기 후보 렌더링
        render(<RulePanel analysis={analysis()} candidate={candidate(0)} />);
        // 화면의 규정 판단 근거 부족 요소의 화면 표시 확인
        expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
        // 화면의 확인하면 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText(/확인하면/)).not.toBeInTheDocument();
        // 화면의 파울 가능성 있음 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    });

    it("separates facts IFAB K League and VAR evidence", () => {
        // 판정이 있는 후보 렌더링
        render(<RulePanel analysis={analysis()} candidate={candidate(1, judgment)} />);
        // 화면의 확인된 사실 요소의 화면 표시 확인
        expect(screen.getByRole("region", { name: "확인된 사실" })).toBeInTheDocument();
        // 화면의 규정 요소의 화면 표시 확인
        expect(screen.getByRole("region", { name: "IFAB 규정" })).toBeInTheDocument();
        // 화면의 리그 대회요강 요소의 화면 표시 확인
        expect(screen.getByRole("region", { name: "K리그 대회요강" })).toBeInTheDocument();
        // 화면의 검토 요소의 화면 표시 확인
        expect(screen.getByRole("region", { name: "VAR 검토" })).toBeInTheDocument();
        // 화면의 관측 판정 비교 요소의 재개와 카드 비교 문구 표시 확인
        expect(screen.getByRole("region", { name: "관측 판정 비교" })).toHaveTextContent(
            "재개와 카드 비교"
        );
    });

    it("displays the server filter instead of legacy model or user judgments", () => {
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <RulePanel
                analysis={analysis()}
                candidate={{
                    ...candidate(1, judgment),
                    filter: {
                        filterVersion: "pipeline-rules-v1",
                        status: "UNDETERMINED",
                        reasonCodes: ["RULE_CONTEXT_UNVERIFIED", "CONTACT_UNOBSERVED"],
                        missingFields: ["contact"],
                        ruleReferences: [],
                        evidenceIds: []
                    }
                }}
            />
        );
        // 화면의 규정 판단 근거 부족 요소의 화면 표시 확인
        expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
        // 화면의 경기와 적용 규정 판본이 확인되지 않았습니다 요소의 화면 표시 확인
        expect(screen.getByText("경기와 적용 규정 판본이 확인되지 않았습니다")).toBeInTheDocument();
        // 화면의 파울 가능성 있음 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("prioritizes a completed competition VAR scope over unknown foul conditions and saved judgments", () => {
        // 원본 시험용 영상 원본 결과 준비
        const source = knownVideoSource(
            "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857"
        )!;
        // 테스트용 득점 표시 단서를 실제 엔진에 전달한 화면 입력 모형이며 실제 영상 검출을 입증 범위 제외
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
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <RulePanel
                analysis={analysis()}
                candidate={{
                    ...candidate(0, judgment),
                    varScopeEvaluation: scope,
                    filter: {
                        filterVersion: "pipeline-rules-v3",
                        status: "UNDETERMINED",
                        reasonCodes: ["RULE_CONTEXT_UNVERIFIED", "CONTACT_UNOBSERVED"],
                        missingFields: ["contact"],
                        ruleReferences: [],
                        evidenceIds: []
                    }
                }}
            />
        );

        // 화면의 득점 관련 검토 범위 요소의 화면 표시 확인
        expect(
            screen.getByRole("heading", { name: "득점 관련 VAR 검토 범위" })
        ).toBeInTheDocument();
        // 화면의 대회요강의 적용 범주에 해당 요소의 화면 표시 확인
        expect(screen.getByText("대회요강의 적용 범주에 해당")).toBeInTheDocument();
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText(scope.question)).toBeInTheDocument();
        // 화면 문구요소조회 결과의 화면 표시 확인
        expect(screen.getByText(scope.explanation)).toBeInTheDocument();
        // 화면의 범위 평가 결과 요소의 적용범위 문구 표시 확인
        expect(screen.getByRole("region", { name: "범위 평가 결과" })).toHaveTextContent(
            scope.explanation
        );
        // 화면의 대회요강 요소의 화면 표시 확인
        expect(
            screen.getByText(`${scope.competition} ${scope.season} · 대회요강`)
        ).toBeInTheDocument();
        // 화면의 분석 근거 요소의 중계의 표시 문구 표시 확인
        expect(screen.getByRole("region", { name: "분석 근거" })).toHaveTextContent(
            "중계의 GOAL 표시"
        );
        // 인용목록 시험용 화면의 리그 대회요강 요소 준비
        const citations = screen.getByRole("region", { name: "K리그 대회요강" });
        // 적용범위 인용목록의 각 사례 순회
        for (const citation of scope.citations) {
            // 인용목록의 지정 형식 문자열 문구 표시 확인
            expect(citations).toHaveTextContent(`${citation.law} ${citation.section}`);
            // 인용목록의 인용 인용스냅샷 문구 표시 확인
            expect(citations).toHaveTextContent(citation.quoteSnapshot);
            // 인용목록 요소조회 결과의 값 존재 확인
            expect(citations.querySelector(`a[href='${citation.sourceUrl}']`)).not.toBeNull();
        }
        // 화면의 제공된 대회요강의 적용 범주 분석이며 실제 득점 인정· 실시·원심 오류·개입 필요성을 뜻하지 않습니다 요소의 화면 표시 확인
        expect(
            screen.getByText(
                "제공된 대회요강의 적용 범주 분석이며 실제 득점 인정·VAR 실시·원심 오류·개입 필요성을 뜻하지 않습니다"
            )
        ).toBeInTheDocument();
        // 화면의 규정 판단 근거 부족 조건 미확인 파울 가능성 있음 규정 판본 미확인 요소의 화면에 표시되지 않음 확인
        expect(
            screen.queryByText(/규정 판단 근거 부족|조건 미확인|파울 가능성 있음|규정 판본 미확인/)
        ).not.toBeInTheDocument();
        // 화면의 규정 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "IFAB 규정" })).not.toBeInTheDocument();
        // 화면의 확인된 사실 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "확인된 사실" })).not.toBeInTheDocument();
        // 화면의 검토 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "VAR 검토" })).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("긴 인용을 접어서 핵심 조항을 먼저 표시", () => {
        // 핵심 세 건 이후 인용은 펼쳐보기로 제공
        const citations = Array.from({ length: 6 }, (_, index) => ({
            ...judgment.citations[0]!,
            ruleId: `ifab-${index}`,
            section: String(index + 1)
        }));
        // 화면컨테이너 시험용 화면렌더링 결과 준비
        const { container } = render(
            <RulePanel analysis={analysis()} candidate={candidate(1, { ...judgment, citations })} />
        );
        // 화면의 추가 조항 3개 요소의 화면 표시 확인
        expect(screen.getByText("추가 조항 3개")).toBeInTheDocument();
        // 화면컨테이너 요소조회 결과의 지정 속성 미적용 확인
        expect(container.querySelector(".citation-more")).not.toHaveAttribute("open");
        // 화면컨테이너 요소조회 결과의 항목 수 3 확인
        expect(
            container.querySelector("section[aria-label='IFAB 규정'] > .citation-list")?.children
        ).toHaveLength(3);
    });

    it.each([null, "ifab-2026-27"])(
        "shows the observed corner and unverified conditions for context %s",
        (versionId) => {
            // 장면 사건 시험용 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 0 자료 준비
            const sceneEvent = {
                kind: "CORNER_KICK",
                status: "OBSERVED",
                method: "corner-geometry-motion-v1",
                startMs: 0,
                endMs: 2000,
                restartMs: 1000,
                evidenceTimestampsMs: [0, 1000, 1500]
            } as const;
            // 장면 시험용 후보 결과 준비
            const scene = candidate(0, judgment);
            // 필터 시험용 파이프라인 필터 결과 준비
            const filter = pipelineFilter(
                { ...scene, sceneEvent, category: "OTHER", evidenceIds: ["corner-frame"] },
                versionId ? ruleSet(versionId) : null
            );
            // 현재 시험자료로 화면 컴포넌트 렌더링
            render(
                <RulePanel analysis={analysis()} candidate={{ ...scene, sceneEvent, filter }} />
            );
            // 화면의 코너킥 장면 요소의 화면 표시 확인
            expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
            // 화면의 코너킥 검토 조건 요소의 직접 공을 받은 경우 문구 표시 확인
            expect(screen.getByRole("region", { name: "코너킥 검토 조건" })).toHaveTextContent(
                "직접 공을 받은 경우"
            );
            // 화면의 조건 미확인 요소의 항목 수 4 확인
            expect(screen.getAllByText(/조건 미확인/)).toHaveLength(4);
            // 화면의 파울 가능성 있음 요소의 화면에 표시되지 않음 확인
            expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
            // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
            expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
            // 화면 역할요소검색 결과의 화면에 표시되지 않음 확인
            expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
            // 버전 식별자에 따른 처리 경로 분기
            if (versionId) {
                // 화면의 검증된 적용 판본 · 검토 규정 요소의 화면 표시 확인
                expect(screen.getByText("검증된 적용 판본 · 검토 규정")).toBeInTheDocument();
                // 화면의 검토 기준 조항 요소의 17 1 문구 표시 확인
                expect(screen.getByRole("region", { name: "검토 기준 조항" })).toHaveTextContent(
                    "17 1"
                );
                // 화면의 적용 판본 원문 보기 요소 중 선택 항목의 지정 속성 적용 확인
                expect(
                    screen.getAllByRole("link", { name: "적용 판본 원문 보기" })[0]
                ).toHaveAttribute("href", expect.stringContaining("202627"));
            } else {
                // 화면의 적용 판본 미확정 · 참고 규정 요소의 화면 표시 확인
                expect(screen.getByText("적용 판본 미확정 · 참고 규정")).toBeInTheDocument();
                // 화면의 검토 기준 조항 요소의 화면에 표시되지 않음 확인
                expect(
                    screen.queryByRole("region", { name: "검토 기준 조항" })
                ).not.toBeInTheDocument();
            }
        }
    );

    it("keeps a recognized corner visible when its video evidence is unavailable", () => {
        // 장면 사건 시험용 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 0 자료 준비
        const sceneEvent = {
            kind: "CORNER_KICK",
            status: "OBSERVED",
            method: "corner-geometry-motion-v1",
            startMs: 0,
            endMs: 2000,
            restartMs: 1000,
            evidenceTimestampsMs: [0, 1000, 1500]
        } as const;
        // 장면 시험 입력으로 기존 항목 및 장면 사건 및 근거 자료 생성
        const scene = { ...candidate(0, judgment), sceneEvent, evidence: [] };
        // 필터 시험용 파이프라인 필터 결과 준비
        const filter = pipelineFilter({ ...scene, category: "OTHER", evidenceIds: [] }, null);
        // 결과 시험 입력으로 기존 항목 및 진단 자료 생성
        const result = {
            ...analysis(),
            diagnostics: {
                rawProposalCount: 1,
                invalidOutputCount: 0,
                recognizedEventCount: 1,
                supportedEventTypes: ["CORNER_KICK"] as const,
                reasons: ["EVIDENCE_UNAVAILABLE"]
            }
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
        // 화면의 코너킥 장면 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "코너킥 장면" })).toBeInTheDocument();
        // 화면의 영상 근거 제공 불가 요소의 화면 표시 확인
        expect(screen.getByText("영상 근거 제공 불가")).toBeInTheDocument();
        // 화면의 이 장면의 영상 근거를 제공할 수 없습니다 요소의 화면 표시 확인
        expect(screen.getByText("이 장면의 영상 근거를 제공할 수 없습니다")).toBeInTheDocument();
        // 화면의 규정 조건의 충족 여부는 확인되지 않았습니다 요소의 화면 표시 확인
        expect(
            screen.getByText(/IFAB 규정 조건의 충족 여부는 확인되지 않았습니다/)
        ).toBeInTheDocument();
        // 화면의 경기와 적용 규정 판본이 확인되지 않았습니다 요소의 화면 표시 확인
        expect(screen.getByText("경기와 적용 규정 판본이 확인되지 않았습니다")).toBeInTheDocument();
        // 화면의 규정 판단 근거 부족 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("규정 판단 근거 부족")).not.toBeInTheDocument();
        // 화면의 판정 보류 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("판정 보류")).not.toBeInTheDocument();
        // 화면의 파울 가능성 있음 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
        // 화면의 파울 근거 없음 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("파울 근거 없음")).not.toBeInTheDocument();
        // 화면의 코너킥 검토 조건 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("region", { name: "코너킥 검토 조건" })).not.toBeInTheDocument();
        // 결과가 미확정 상태로 유지됨 확인
        expect(filter.status).toBe("UNDETERMINED");
        // 근거 사용 불가 사유가 결과에 포함됨 확인
        expect(filter.reasonCodes).toContain("EVIDENCE_UNAVAILABLE");
    });

    it("preserves unverified law conditions supplied with a corner lacking video evidence", () => {
        // 장면 사건 시험용 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 0 자료 준비
        const sceneEvent = {
            kind: "CORNER_KICK",
            status: "OBSERVED",
            method: "corner-geometry-motion-v1",
            startMs: 0,
            endMs: 2000,
            restartMs: 1000,
            evidenceTimestampsMs: [0, 1000, 1500]
        } as const;
        // 장면 시험 입력으로 기존 항목 및 장면 사건 및 근거 자료 생성
        const scene = { ...candidate(0), sceneEvent, evidence: [] };
        // 코너킥 필터 시험용 파이프라인 필터 결과 준비
        const cornerFilter = pipelineFilter(
            { ...scene, category: "OTHER", evidenceIds: ["corner-frame"] },
            ruleSet("ifab-2026-27")
        );
        // 필터 시험 입력으로 기존 항목 및 상태 및 사유코드목록 및 근거 식별자목록 자료 생성
        const filter = {
            ...cornerFilter,
            status: "UNDETERMINED" as const,
            reasonCodes: ["EVIDENCE_UNAVAILABLE"] as const,
            evidenceIds: []
        };
        // 결과 시험 입력으로 기존 항목 및 진단 자료 생성
        const result = {
            ...analysis(),
            diagnostics: {
                rawProposalCount: 1,
                invalidOutputCount: 0,
                recognizedEventCount: 1,
                supportedEventTypes: ["CORNER_KICK"] as const,
                reasons: ["EVIDENCE_UNAVAILABLE"]
            }
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
        // 화면의 코너킥 검토 조건 요소의 직접 공을 받은 경우 문구 표시 확인
        expect(screen.getByRole("region", { name: "코너킥 검토 조건" })).toHaveTextContent(
            "직접 공을 받은 경우"
        );
        // 화면의 조건 미확인 요소의 항목 수 4 확인
        expect(screen.getAllByText(/조건 미확인/)).toHaveLength(4);
        // 화면의 검토 기준 조항 요소의 17 1 문구 표시 확인
        expect(screen.getByRole("region", { name: "검토 기준 조항" })).toHaveTextContent("17 1");
        // 각 규정 조건이 모두 미검증 상태로 보존됨 확인
        expect(filter.conditions?.every((condition) => condition.status === "UNVERIFIED")).toBe(
            true
        );
        // 결과가 미확정 상태로 유지됨 확인
        expect(filter.status).toBe("UNDETERMINED");
    });

    it("does not identify a corner from missing evidence without a valid scene event", () => {
        // 장면 시험 입력으로 기존 항목 및 근거 자료 생성
        const scene = { ...candidate(0), evidence: [] };
        // 필터 시험용 파이프라인 필터 결과 준비
        const filter = pipelineFilter({ ...scene, category: "CORNER_KICK", evidenceIds: [] }, null);
        // 결과 시험 입력으로 기존 항목 및 진단 자료 생성
        const result = {
            ...analysis(),
            diagnostics: {
                rawProposalCount: 1,
                invalidOutputCount: 0,
                recognizedEventCount: 0,
                supportedEventTypes: ["CORNER_KICK"] as const,
                reasons: ["SCENE_EVENT_UNAVAILABLE"]
            }
        };
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<RulePanel analysis={result} candidate={{ ...scene, filter }} />);
        // 화면의 규정 판단 근거 부족 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "규정 판단 근거 부족" })).toBeInTheDocument();
        // 화면의 세트피스의 시간대별 관찰 근거가 없습니다 요소의 화면 표시 확인
        expect(screen.getByText("세트피스의 시간대별 관찰 근거가 없습니다")).toBeInTheDocument();
        // 화면의 코너킥 장면 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("heading", { name: "코너킥 장면" })).not.toBeInTheDocument();
    });

    it("preserves the legacy missing-evidence result when diagnostics are absent", () => {
        // 장면 사건 시험용 종류 코너킥 및 상태 관측완료 및 방법 코너킥 및 시작시각 0 자료 준비
        const sceneEvent = {
            kind: "CORNER_KICK",
            status: "OBSERVED",
            method: "corner-geometry-motion-v1",
            startMs: 0,
            endMs: 2000,
            restartMs: 1000,
            evidenceTimestampsMs: [0, 1000, 1500]
        } as const;
        // 장면 시험 입력으로 기존 항목 및 장면 사건 및 근거 자료 생성
        const scene = { ...candidate(0), sceneEvent, evidence: [] };
        // 필터 시험용 파이프라인 필터 결과 준비
        const filter = pipelineFilter({ ...scene, category: "OTHER", evidenceIds: [] }, null);
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(<RulePanel analysis={analysis()} candidate={{ ...scene, filter }} />);
        // 화면의 규정 판단 근거 부족 요소의 화면 표시 확인
        expect(screen.getByRole("heading", { name: "규정 판단 근거 부족" })).toBeInTheDocument();
        // 화면의 이 장면의 영상 근거를 제공할 수 없습니다 요소의 화면 표시 확인
        expect(screen.getByText("이 장면의 영상 근거를 제공할 수 없습니다")).toBeInTheDocument();
        // 화면의 코너킥 장면 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByRole("heading", { name: "코너킥 장면" })).not.toBeInTheDocument();
        // 화면의 영상 근거 제공 불가 요소의 화면에 표시되지 않음 확인
        expect(screen.queryByText("영상 근거 제공 불가")).not.toBeInTheDocument();
    });
});
