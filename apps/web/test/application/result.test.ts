// 결과 유스케이스 테스트
import { describe, expect, it } from "vitest";
import {
    report,
    type AnalysisResultCommand,
    type AnalysisResultStore,
    type AnalysisView
} from "@replay/application";
import { analysis as fixture } from "../fixtures/result";
import { competitionRules } from "@replay/rule-data";
import { scopeVerdict } from "@replay/rule-engine";
import { knownVideoSource } from "../../src/adapters/sources";
import { automaticJudgment } from "../fixtures/automatic";

// 세션 시험용 11111111 1111 4111 8111 111111111111 준비
const SESSION = "11111111-1111-4111-8111-111111111111";
// 분석 시험용 22222222 2222 4222 8222 222222222222 준비
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-09-03T00:00:00.000Z");

// 결과 화면 모형
const view = {
    analysisId: ANALYSIS,
    mode: "VISUAL_CHANGE_BASELINE",
    judgmentStatus: "NOT_EVALUATED",
    status: "CANDIDATES_READY",
    stage: "SUCCEEDED",
    progressPercent: 100,
    failureCode: null,
    limitations: [],
    candidates: [],
} satisfies AnalysisView;

class ResultDouble implements AnalysisResultStore {
    commands: AnalysisResultCommand[] = [];

    // 검증용 분석 구성
    async analysis(command: AnalysisResultCommand) {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 화면자료 반환
        return view;
    }
}

describe("analysis result", () => {
    it("publishes a completed server automatic judgment independently of VAR scope and strips private diagnostics", async () => {
        // 기본자료 시험용 시험자료 결과 준비
        const base = fixture();
        // 자동평가 시험용 자동평가 판정 결과 준비
        const automatic = automaticJudgment();
        // 비공개 자동평가 시험 입력으로 기존 항목 및 결과 자료 생성
        const privateAutomatic = {
            ...automatic,
            result: {
                ...automatic.result,
                factSignatureInput: "private contactDetected",
                accounts: [{ privateObservation: true }]
            }
        };
        // 내부 시험 입력으로 기존 항목 및 후보목록 및 자동평가 요약 및 진단 자료 생성
        const internal: AnalysisView = {
            ...base,
            candidates: [
                { ...base.candidates[0]!, automaticJudgment: privateAutomatic },
                base.candidates[1]!
            ],
            automaticReviewSummary: {
                videoCoverage: "FULL",
                summaryTruncated: false,
                checkedCount: 2,
                completedCount: 1,
                blockedCount: 1
            },
            diagnostics: {
                rawProposalCount: 2,
                invalidOutputCount: 0,
                recognizedEventCount: 0,
                supportedEventTypes: [],
                reasons: []
            }
        };
        // 작업 시험용 보고서 결과 준비
        const operation = report({
            clock: { now: () => NOW },
            repository: { analysis: async () => internal }
        });
        // 작업 결과를 출력에 저장
        const output = await operation({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
        // 출력의 결과정책 완료 및 평가완료 개수 1 및 완료 적용범위 개수 0 및 판정 상태 부분 자료의 필드 일치 확인
        expect(output).toMatchObject({
            resultPolicy: "COMPLETED_ONLY",
            evaluatedCount: 1,
            completedScopeCount: 0,
            judgmentStatus: "PARTIAL",
            candidates: [{ automaticJudgment: automatic, judgment: null, signalScore: null }]
        });
        // 출력의 자동평가 요약 항목 없음 확인
        expect(output).not.toHaveProperty("automaticReviewSummary");
        // 응답본문 직렬화 결과의 사실 서명 입력 미포함 확인
        expect(JSON.stringify(output)).not.toContain("factSignatureInput");
        // 응답본문 직렬화 결과의 접촉감지여부 미포함 확인
        expect(JSON.stringify(output)).not.toContain("contactDetected");
        // 6개 항목 목록의 각 사례 순회
        for (const changed of [
            { ...automatic, candidateIndex: 2 },
            { ...automatic, status: "BLOCKED" },
            { ...automatic, evidenceIds: [] },
            { ...automatic, producer: null },
            { ...automatic, result: { ...automatic.result, decision: "INCONCLUSIVE" } },
            { ...automatic, result: { ...automatic.result, restart: null } }
        ]) {
            // 보고서 결과를 결과에 저장
            const result = await report({
                clock: { now: () => NOW },
                repository: {
                    analysis: async () =>
                        ({
                            ...internal,
                            candidates: [{ ...base.candidates[0]!, automaticJudgment: changed }]
                        }) as AnalysisView
                }
            })({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
            // 결과의 후보목록 및 평가완료 개수 0 자료의 필드 일치 확인
            expect(result).toMatchObject({ candidates: [], evaluatedCount: 0 });
        }
    });
    it("publishes a completed competition-scope answer without inventing a foul judgment", async () => {
        // 기본자료 시험용 시험자료 결과 준비
        const base = fixture();
        // 후보 시험용 기본자료 후보목록 중 선택 항목 준비
        const candidate = base.candidates[0]!;
        // 단서 시험용 종류 지정 문자열 및 방법 방송 및 시작시각 1000 및 종료시각 1400 자료 준비
        const cue = {
            kind: "GOAL_GRAPHIC",
            method: "broadcast-goal-glyphs-v1",
            startMs: 1000,
            endMs: 1400,
            evidenceTimestampsMs: [1000, 1200, 1400]
        } as const;
        // 원본 시험용 영상 원본 결과 준비
        const source = knownVideoSource(
            "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857"
        )!;
        // 적용범위 시험용 적용범위 판단 결과 준비
        const scope = scopeVerdict(
            {
                broadcastCue: cue,
                startMs: 0,
                endMs: 2000,
                source,
                evidence: candidate.evidence!.map((item) => ({ ...item, startMs: 0, endMs: 2000 }))
            },
            competitionRules("K리그2", "2026")
        )!;
        // 완료 시험 입력으로 기존 항목 및 방송 단서 및 비디오판독범위평가 및 판정 빈 값 자료 생성
        const completed = {
            ...candidate,
            broadcastCue: cue,
            varScopeEvaluation: scope,
            judgment: null
        };
        // 내부 시험 입력으로 기존 항목 및 후보목록 및 진단 자료 생성
        const internal: AnalysisView = {
            ...base,
            candidates: [completed, base.candidates[1]!],
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 0,
                recognizedEventCount: 2,
                supportedEventTypes: ["GOAL_GRAPHIC"],
                reasons: []
            }
        };
        // 작업 시험용 보고서 결과 준비
        const operation = report({
            clock: { now: () => NOW },
            repository: { analysis: async () => internal }
        });
        // 작업 결과를 값에 저장
        const value = await operation({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(value).toMatchObject({
            resultPolicy: "COMPLETED_ONLY",
            completedScopeCount: 1,
            evaluatedCount: 0,
            judgmentStatus: "NOT_EVALUATED",
            candidates: [{ varScopeEvaluation: scope, judgment: null }]
        });
        // 값 비교 조건 비교 조건의 항목 수 1 확인
        expect(value && !("kind" in value) && value.candidates).toHaveLength(1);
        // 값의 규정 항목 존재 확인
        expect(value).toHaveProperty("rule", null);
        // 내부 후보목록의 항목 수 2 확인
        expect(internal.candidates).toHaveLength(2);

        // 3개 항목 목록의 각 사례 순회
        for (const legacySource of ["MODEL", "USER", "CURATOR"] as const) {
            // 시험자료 시험용 기본자료 후보목록 조회 결과 판정 준비
            const old = base.candidates.find((item) => item.judgment)!.judgment!;
            // 시험자료 시험 입력으로 기존 항목 및 사실 및 사실 개정번호 식별자 및 판정 자료 생성
            const mixed = {
                ...completed,
                facts: old.facts,
                factRevisionId: old.factRevisionId,
                judgment: { ...old, source: legacySource },
                observation: {
                    model: "legacy-only",
                    category: "UNKNOWN",
                    contact: "UNKNOWN",
                    displacement: "uncertain",
                    camera: "LOW",
                    summary: "과거 관찰",
                    timestamps: [1000]
                }
            };
            // 보고서 결과를 공개값에 저장
            const published = await report({
                clock: { now: () => NOW },
                repository: {
                    analysis: async () => ({ ...internal, candidates: [mixed] }) as AnalysisView
                }
            })({ anonymousSessionId: SESSION, analysisId: ANALYSIS });
            // 공개값 부정 조건 비교 조건에 따른 처리 경로 분기
            if (!published || "kind" in published) throw new Error("missing-scope-report");
            // 공개값 후보목록의 항목 수 1 확인
            expect(published.candidates).toHaveLength(1);
            // 공개값 후보목록 중 선택 항목 판정의 빈 값 확인
            expect(published.candidates[0]?.judgment).toBeNull();
            // 공개값 후보목록 중 선택 항목의 사실 항목 없음 확인
            expect(published.candidates[0]).not.toHaveProperty("facts");
            // 공개값 후보목록 중 선택 항목의 관측 항목 없음 확인
            expect(published.candidates[0]).not.toHaveProperty("observation");
            // 공개값 후보목록 중 선택 항목의 사실 개정번호 식별자 항목 없음 확인
            expect(published.candidates[0]).not.toHaveProperty("factRevisionId");
        }

        // 5개 항목 목록의 각 사례 순회
        for (const changed of [
            { ...completed, broadcastCue: null },
            { ...completed, evidence: [] },
            { ...completed, varScopeEvaluation: { ...scope, status: "OBSERVED" } },
            {
                ...completed,
                varScopeEvaluation: {
                    ...scope,
                    provenance: { ...scope.provenance, origin: "MODEL" }
                }
            },
            {
                ...completed,
                varScopeEvaluation: {
                    ...scope,
                    provenance: { ...scope.provenance, cueStartMs: 999 }
                }
            }
        ]) {
            // 보고서 결과를 결과에 저장
            const result = await report({
                clock: { now: () => NOW },
                repository: {
                    analysis: async () => ({ ...internal, candidates: [changed] }) as AnalysisView
                }
            })({
                anonymousSessionId: SESSION,
                analysisId: ANALYSIS
            });
            // 결과의 후보목록 및 완료 적용범위 개수 0 자료의 필드 일치 확인
            expect(result).toMatchObject({ candidates: [], completedScopeCount: 0 });
        }
    });

    it("publishes no unfinished automatic results and keeps diagnostics internal", async () => {
        // 내부 시험 입력으로 기존 항목 및 진단 및 필터 요약 자료 생성
        const internal: AnalysisView = {
            ...fixture(),
            diagnostics: {
                rawProposalCount: 39,
                invalidOutputCount: 0,
                recognizedEventCount: 2,
                supportedEventTypes: ["CORNER_KICK"],
                reasons: ["UNRECOGNIZED_PROPOSALS"]
            },
            filterSummary: {
                checkedCount: 41,
                excludedCount: 0,
                undeterminedCount: 39,
                observedCount: 2,
                applicableCount: 0
            }
        };
        // 원본 시험용 깊은복사 결과 준비
        const original = structuredClone(internal);
        // 보고서 결과를 값에 저장
        const value = await report({
            clock: { now: () => NOW },
            repository: { analysis: async () => internal }
        })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS
        });
        // 미평가 조건을 포함한 기대 결과 일치 확인
        expect(value).toMatchObject({
            resultPolicy: "COMPLETED_ONLY",
            candidates: [],
            evaluatedCount: 0,
            mode: "VISUAL_CHANGE_BASELINE",
            judgmentStatus: "NOT_EVALUATED"
        });
        // 값의 진단 항목 없음 확인
        expect(value).not.toHaveProperty("diagnostics");
        // 값의 필터 요약 항목 없음 확인
        expect(value).not.toHaveProperty("filterSummary");
        // 내부의 원본 기준 구조 일치 확인
        expect(internal).toEqual(original);
    });

    it.each(["MODEL", "USER", "CURATOR"] as const)(
        "does not reuse a %s judgment as a completed automatic evaluation",
        async (source) => {
            // 시험자료 시험용 시험자료 결과 준비
            const previous = fixture();
            // 후보 시험용 시험자료 반환값 후보목록 조회 결과 준비
            const candidate = previous.candidates.find((item) => item.judgment)!;
            // 내부 시험 입력으로 기존 항목 및 모드 지정 문자열 및 판정 상태 평가완료 및 평가완료 개수 1 자료 생성
            const internal: AnalysisView = {
                ...previous,
                mode: "ADJUDICATED",
                judgmentStatus: "EVALUATED",
                evaluatedCount: 1,
                candidates: [{ ...candidate, judgment: { ...candidate.judgment!, source } }],
                diagnostics: {
                    rawProposalCount: 0,
                    invalidOutputCount: 0,
                    recognizedEventCount: 1,
                    supportedEventTypes: ["CORNER_KICK"],
                    reasons: []
                }
            };
            // 보고서 결과를 값에 저장
            const value = await report({
                clock: { now: () => NOW },
                repository: { analysis: async () => internal }
            })({
                anonymousSessionId: SESSION,
                analysisId: ANALYSIS
            });
            // 미평가 조건을 포함한 기대 결과 일치 확인
            expect(value).toMatchObject({
                resultPolicy: "COMPLETED_ONLY",
                candidates: [],
                evaluatedCount: 0,
                judgmentStatus: "NOT_EVALUATED"
            });
        }
    );

    it("keeps a missing analysis missing", async () => {
        // 보고서 결과의 빈 값 확인
        expect(
            await report({ clock: { now: () => NOW }, repository: { analysis: async () => null } })(
                {
                    anonymousSessionId: SESSION,
                    analysisId: ANALYSIS
                }
            )
        ).toBeNull();
    });

    it("loads only an analysis owned by the active anonymous session", async () => {
        // 소유 분석 조회 실행
        const repository = new ResultDouble();
        // 보고서 결과를 값에 저장
        const value = await report({ clock: { now: () => NOW }, repository })({
            anonymousSessionId: SESSION,
            analysisId: ANALYSIS
        });

        // 값의 화면자료 기준 구조 일치 확인
        expect(value).toEqual(view);
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            { anonymousSessionId: SESSION, analysisId: ANALYSIS, now: NOW.toISOString() }
        ]);
    });

    it("rejects malformed identifiers before the repository", async () => {
        // 잘못된 식별자 조회 실행
        const repository = new ResultDouble();
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            report({ clock: { now: () => NOW }, repository })({
                anonymousSessionId: SESSION,
                analysisId: "bad"
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});
