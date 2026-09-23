"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import { useCallback, useState } from "react";
import * as React from "react";
import type { AnalysisView, CandidateView } from "@replay/application";
import { RulePanel } from "../RulePanel";
import { SceneList } from "../SceneList";

// 장면 증거 선택
const media = (candidate: CandidateView, kind: "FRAME" | "CLIP") =>
    candidate.evidence?.find(
        (item) =>
            item.kind === kind &&
            (kind !== "CLIP" ||
                !candidate.automaticJudgment ||
                candidate.automaticJudgment.evidenceIds.includes(item.evidenceId))
    ) ?? null;

// 증거 주소 생성
const source = (analysisId: string, evidenceId: string) =>
    `/api/analyses/${analysisId}/evidence/${evidenceId}`;

// 화면 요소 구성
export function SceneView({ analysis }: Readonly<{ analysis: AnalysisView }>) {
    // 서버에서 제외 후보를 제거한 뒤 남은 결과만 재생
    // 완료된 범위 평가를 우선 보여주되 이후 사용자가 선택한 위치는 유지
    const [index, setIndex] = useState(() => {
        // 자동 규정 평가나 범위 평가를 완료한 첫 후보 위치 검색
        const completed = analysis.candidates.findIndex(
            (candidate) =>
                candidate.automaticJudgment?.status === "COMPLETED" ||
                (candidate.varScopeEvaluation?.kind === "COMPETITION_VAR_SCOPE" &&
                    candidate.varScopeEvaluation.status === "COMPLETED")
        );
        // 완료된 평가 후보가 있으면 해당 위치를 초기 선택으로 반환
        if (completed >= 0) return completed;
        // 관측된 코너킥을 우선 선택하고 없으면 첫 후보 위치 반환
        return Math.max(
            0,
            analysis.candidates.findIndex((candidate) =>
                analysis.diagnostics
                    ? candidate.sceneEvent?.kind === "CORNER_KICK" &&
                      candidate.sceneEvent.status === "OBSERVED"
                    : candidate.filter?.situation === "CORNER_KICK" &&
                      (candidate.filter.status === "OBSERVED" ||
                          candidate.filter.status === "APPLICABLE")
            )
        );
    });
    // 마지막 후보 위치 계산
    const last = analysis.candidates.length - 1;
    // 현재 후보 선택
    const candidate = analysis.candidates[index] ?? null;

    // 장면 위치 제한
    const select = useCallback(
        (value: number) => {
            // 요청한 장면 위치를 첫 후보와 마지막 후보 사이로 제한
            setIndex(Math.max(0, Math.min(value, last)));
        },
        [last]
    );

    // 키보드 장면 이동
    const key = useCallback(
        (event: React.KeyboardEvent<HTMLElement>) => {
            // 입력 요소의 방향키는 장면 이동에 사용하지 않도록 확인
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLSelectElement ||
                event.target instanceof HTMLTextAreaElement
            )
                // 현재 입력에 대한 후속 동작 종료
                return;
            // 왼쪽 방향키의 이전 장면 이동 여부 확인
            if (event.key === "ArrowLeft") {
                // 현재 입력의 브라우저 기본 동작 차단
                event.preventDefault();
                // 현재 위치보다 앞선 후보 선택
                select(index - 1);
            }
            // 오른쪽 방향키의 다음 장면 이동 여부 확인
            if (event.key === "ArrowRight") {
                // 현재 입력의 브라우저 기본 동작 차단
                event.preventDefault();
                // 현재 위치보다 뒤의 후보 선택
                select(index + 1);
            }
        },
        [index, select]
    );

    // 작업 상태와 단계 및 실패 코드로 영상 처리 실패 확인
    if (analysis.status === "FAILED" || analysis.stage === "FAILED" || analysis.failureCode) {
        // 현재 상태에 맞는 장면 재생과 안내 화면 반환
        return (
            <section className="scene-gallery empty">
                {/* 영상 처리 실패 제목 표시 */}
                <h2>영상 처리를 완료하지 못했습니다</h2>
                {/* 선택 장면의 안내 문구 표시 */}
                <p>
                    처리 오류로 완료된 분석 결과를 제공할 수 없습니다. 파울이 없다는 판정은 아닙니다
                </p>
            </section>
        );
    }
    // 완료된 평가만 공개하는 정책에서 표시할 후보가 없는지 확인
    if (analysis.resultPolicy === "COMPLETED_ONLY" && !candidate) {
        // 현재 상태에 맞는 장면 재생과 안내 화면 반환
        return (
            <section className="scene-gallery empty">
                {/* 공개할 완료 평가 부재 제목 표시 */}
                <h2>완료된 분석 결과가 없습니다</h2>
                {/* 선택 장면의 안내 문구 표시 */}
                <p>
                    이번 영상에서 규정 평가를 완료한 장면이 없습니다. 파울이 없다는 판정은 아닙니다
                </p>
            </section>
        );
    }

    // 후보 장면 없음 표시
    if (!candidate) {
        // 현재 상태에 맞는 장면 재생과 안내 화면 반환
        return (
            <section className="scene-gallery empty">
                {/* 선택 장면의 구역 제목 표시 */}
                <h2>
                    {analysis.diagnostics
                        ? "인식된 코너킥 장면이 없습니다"
                        : "탐지된 주요 장면이 없습니다"}
                </h2>
                {analysis.diagnostics ? (
                    // 선택 장면의 안내 문구 표시
                    <p>
                        현재 인식 범위는 코너킥 장면입니다. 다른 사건이나 파울이 없다는 뜻은
                        아닙니다
                    </p>
                ) : null}
            </section>
        );
    }

    // 현재 후보의 대표 프레임 선택
    const frame = media(candidate, "FRAME");
    // 현재 후보의 클립 선택
    const clip = media(candidate, "CLIP");
    // 현재 후보의 대표 프레임 주소 생성
    const frameSource = frame ? source(analysis.analysisId, frame.evidenceId) : undefined;
    // 선택 후보의 비디오 판독 범위 평가 읽음
    const scope = candidate.varScopeEvaluation;
    // 득점 관련 비디오 판독 범위 평가 완료 여부 확인
    const completedGoalScope =
        scope?.kind === "COMPETITION_VAR_SCOPE" &&
        scope.status === "COMPLETED" &&
        scope.topic === "GOAL_RELATED";
    // 완료된 평가와 관측 사건에 맞는 장면 이름 선택
    const sceneLabel =
        candidate.automaticJudgment?.status === "COMPLETED"
            ? "밀기 평가 장면"
            : completedGoalScope
              ? "득점 관련 장면"
              : candidate.sceneEvent?.kind === "CORNER_KICK" &&
                  candidate.sceneEvent.status === "OBSERVED"
                ? "코너킥 장면"
                : "후보 장면";
    // 진단 장면의 영상 근거 제공 불가 여부 확인
    const evidenceUnavailable =
        Boolean(analysis.diagnostics) &&
        sceneLabel === "코너킥 장면" &&
        candidate.filter?.reasonCodes.includes("EVIDENCE_UNAVAILABLE");

    // 현재 상태에 맞는 장면 재생과 안내 화면 반환
    return (
        <section className="scene-gallery" aria-label="장면 캐러셀" tabIndex={0} onKeyDown={key}>
            {/* 선택 영상과 후보 목록의 화면 묶음 표시 */}
            <div className="gallery-main">
                {/* 선택 장면 재생과 제목의 화면 묶음 표시 */}
                <div className="scene-stage">
                    {/* 선택 장면 영상 근거의 화면 묶음 표시 */}
                    <div className="scene-media">
                        {/* 클립과 프레임과 준비 문구 중 하나 표시 */}
                        {clip ? (
                            // 선택 장면의 영상 재생기 표시
                            <video
                                // 반복 화면 요소의 고유 항목 구분
                                key={clip.evidenceId}
                                // 브라우저 기본 영상 재생 조작부 표시
                                controls
                                // 영상의 미리 읽기 범위 지정
                                preload="metadata"
                                // 재생 전 대표 프레임을 영상 표지로 연결
                                poster={frameSource}
                                // 표시할 영상이나 이미지 주소 연결
                                src={source(analysis.analysisId, clip.evidenceId)}
                            />
                        ) : frameSource ? (
                            // 선택 장면의 이미지 표시
                            <img
                                // 표시할 영상이나 이미지 주소 연결
                                src={frameSource}
                                // 이미지를 볼 수 없을 때 사용할 설명 연결
                                alt={`${sceneLabel} ${String(index + 1).padStart(2, "0")} 핵심 프레임`}
                            />
                        ) : (
                            // 선택 장면의 안내 문구 표시
                            <p>{evidenceUnavailable ? "영상 근거 제공 불가" : "영상 준비 중"}</p>
                        )}
                    </div>
                    {/* 선택 장면 이름과 이동 조작부의 화면 묶음 표시 */}
                    <div className="scene-caption">
                        {/* 선택 장면의 화면 묶음 표시 */}
                        <div>
                            {/* 선택 장면의 짧은 문구 표시 */}
                            <span>선택 장면</span>
                            {/* 선택 장면의 강조 문구 표시 */}
                            <strong>
                                {sceneLabel} {String(index + 1).padStart(2, "0")}
                            </strong>
                        </div>
                        {/* 이전 다음 장면 이동의 이동 메뉴 표시 */}
                        <nav className="scene-controls" aria-label="장면 이동">
                            {/* 이전 후보 이동 버튼 */}
                            <button
                                type="button"
                                // 보조 기술이 읽을 화면 요소 이름 지정
                                aria-label="이전 장면"
                                // 진행 상태와 선택 조건에 따라 입력 잠금
                                disabled={index === 0}
                                // 클릭 시 연결된 화면 동작 실행
                                onClick={() => select(index - 1)}
                            >
                                {/* 선택 장면의 벡터 아이콘 표시 */}
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m15 18-6-6 6-6" />
                                </svg>
                            </button>
                            {/* 선택 장면의 짧은 문구 표시 */}
                            <span>
                                {String(index + 1).padStart(2, "0")} /{" "}
                                {String(analysis.candidates.length).padStart(2, "0")}
                            </span>
                            {/* 다음 후보 이동 버튼 */}
                            <button
                                type="button"
                                // 보조 기술이 읽을 화면 요소 이름 지정
                                aria-label="다음 장면"
                                // 진행 상태와 선택 조건에 따라 입력 잠금
                                disabled={index === last}
                                // 클릭 시 연결된 화면 동작 실행
                                onClick={() => select(index + 1)}
                            >
                                {/* 선택 장면의 벡터 아이콘 표시 */}
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </button>
                        </nav>
                    </div>
                </div>
                {/* 후보 장면 목록 표시 */}
                <SceneList
                    analysisId={analysis.analysisId}
                    candidates={analysis.candidates}
                    active={index}
                    onSelect={select}
                />
            </div>
            {/* 규정 대조 결과 표시 */}
            <RulePanel analysis={analysis} candidate={candidate} />
        </section>
    );
}
