"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useEffect, useState } from "react";
import type { AnalysisView } from "@replay/application";
import { Footer } from "../../components/Footer";
import { Header } from "../../components/Header";
import { SceneView } from "../../components/SceneView";

// 결과 조회 중과 조회 성공 및 실패를 구분할 상태 형식 정의
type State =
    | Readonly<{ kind: "LOADING" }>
    | Readonly<{ kind: "READY"; analysis: AnalysisView }>
    | Readonly<{ kind: "ERROR" }>;

// 화면 요소 구성
export function ResultView({ analysisId }: Readonly<{ analysisId: string }>) {
    // 결과 화면은 서버가 계산한 후보와 규정 필터 상태를 재계산하지 않고 표시
    // 결과 조회 상태 관리
    const [state, setState] = useState<State>({ kind: "LOADING" });
    // 서버 결과가 완료된 평가만 공개하는 정책인지 확인
    const completedOnly =
        state.kind === "READY" && state.analysis.resultPolicy === "COMPLETED_ONLY";

    // 분석 식별자가 바뀔 때 결과 조회와 요청 취소 효과 연결
    useEffect(() => {
        // 분석 식별자에 귀속된 결과만 조회하며 브라우저 상태로 판정 조건을 만들지 않음
        // 결과 요청 취소 제어
        const controller = new AbortController();
        // 분석 결과 요청 경로 요청
        void fetch(`/api/analyses/${analysisId}`, { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                // 오류 응답 중단
                if (!response.ok) throw new Error(String(response.status));
                // 결과 본문 변환
                return response.json() as Promise<AnalysisView>;
            })
            .then((analysis) => {
                // 결과 화면 상태 저장
                setState({ kind: "READY", analysis });
            })
            .catch((error: unknown) => {
                // 취소된 요청은 상태 변경 생략
                if (error instanceof DOMException && error.name === "AbortError") return;
                // 조회 실패 상태 저장
                setState({ kind: "ERROR" });
            });
        // 화면 종료 시 요청 취소
        return () => controller.abort();
    }, [analysisId]);

    // 현재 상태에 맞는 분석 결과 화면 반환
    return (
        <div className="result-page">
            {/* 공통 헤더 표시 */}
            <Header mode="analysis" />
            {state.kind === "LOADING" ? (
                // 분석 결과 조회 상태의 본문 영역 표시
                <main className="result-state" aria-busy="true">
                    {/* 결과 불러오는 중의 안내 문구 표시 */}
                    <p>결과 불러오는 중</p>
                </main>
            ) : null}
            {state.kind === "ERROR" ? (
                // 분석 결과 조회 상태의 본문 영역 표시
                <main className="result-state">
                    {/* 결과 조회 실패 제목 표시 */}
                    <h1>결과를 불러오지 못했습니다</h1>
                    {/* 분석 페이지로 이동의 이동 링크 표시 */}
                    <a href="/analyze">분석 페이지로 이동</a>
                </main>
            ) : null}
            {state.kind === "READY" ? (
                // 분석 결과 본문의 본문 영역 표시
                <main className="result-main">
                    {/* 분석 결과 제목과 새 분석 링크의 제목 영역 표시 */}
                    <header className="result-title">
                        {/* 분석 결과의 화면 묶음 표시 */}
                        <div>
                            {/* 분석 결과의 안내 문구 표시 */}
                            <p>Video review</p>
                            {/* 영상 검토 결과의 페이지 제목 표시 */}
                            <h1>영상 검토 결과</h1>
                        </div>
                        {/* 새 영상 분석의 이동 링크 표시 */}
                        <a href="/analyze">새 영상 분석</a>
                    </header>
                    {completedOnly ? (
                        // 분석 결과의 안내 문구 표시
                        <p role="status">
                            {(state.analysis.evaluatedCount ?? 0) > 0
                                ? `밀기 규정 평가 ${state.analysis.evaluatedCount}건 · VAR 범위 분석 ${state.analysis.completedScopeCount ?? 0}건`
                                : (state.analysis.completedScopeCount ?? 0) > 0
                                  ? `완료된 VAR 범위 분석 ${state.analysis.completedScopeCount}건`
                                  : `완료된 분석 결과 ${state.analysis.candidates.length}건`}
                        </p>
                    ) : (
                        <>
                            {/* · 파이프라인 처리 결과의 안내 문구 표시 */}
                            <p role="status">
                                {state.analysis.diagnostics
                                    ? `인식된 장면 ${state.analysis.diagnostics.recognizedEventCount}건`
                                    : `후보 ${state.analysis.candidates.length}건`}{" "}
                                · 파이프라인 처리 결과
                            </p>
                            {state.analysis.diagnostics ? <p>현재 코너킥 장면 인식 범위</p> : null}
                            {!state.analysis.diagnostics && state.analysis.filterSummary ? (
                                // 분석 결과의 안내 문구 표시
                                <p>
                                    규정 필터 확인 {state.analysis.filterSummary.checkedCount}건 ·
                                    재개 장면 관찰 {state.analysis.filterSummary.observedCount ?? 0}
                                    건 · 검토 규정 연결{" "}
                                    {state.analysis.filterSummary.applicableCount ?? 0}건 · 근거
                                    부족 {state.analysis.filterSummary.undeterminedCount}건 ·
                                    유효하지 않은 구간 제외{" "}
                                    {state.analysis.filterSummary.excludedCount}건
                                </p>
                            ) : null}
                            {/* 분석 결과의 안내 문구 표시 */}
                            <p>
                                영상에서 추출한 장면과 규정 검토 조건입니다. 장면 인식은 규정 준수나
                                파울 판정을 의미하지 않습니다
                            </p>
                        </>
                    )}
                    {/* 장면별 분석 결과 표시 */}
                    <SceneView key={analysisId} analysis={state.analysis} />
                    {!completedOnly && state.analysis.diagnostics ? (
                        // 처리 진단의 내용 구역 표시
                        <section aria-label="처리 진단">
                            {/* 처리 진단의 구역 제목 표시 */}
                            <h2>처리 진단</h2>
                            {/* 사건 종류를 인식하지 못한 내부 후보 건의 안내 문구 표시 */}
                            <p>
                                사건 종류를 인식하지 못한 내부 후보{" "}
                                {state.analysis.diagnostics.rawProposalCount}건
                            </p>
                            {/* 유효하지 않은 처리 결과 건의 안내 문구 표시 */}
                            <p>
                                유효하지 않은 처리 결과{" "}
                                {state.analysis.diagnostics.invalidOutputCount}건
                            </p>
                            {/* 분석 결과의 안내 문구 표시 */}
                            <p>
                                내부 후보는 사건 종류가 확인되지 않은 처리 기록이며 정상 플레이나
                                파울 없음 판정이 아닙니다
                            </p>
                        </section>
                    ) : null}
                </main>
            ) : null}
            {/* 공통 푸터 표시 */}
            <Footer />
        </div>
    );
}
