"use client";

import { useCallback, useState } from "react";
import * as React from "react";
import type { AnalysisView, CandidateView } from "@replay/application";
import { RulePanel } from "../RulePanel";
import { SceneList } from "../SceneList";

// 장면 증거 선택
const media = (candidate: CandidateView, kind: "FRAME" | "CLIP") =>
  candidate.evidence?.find((item) => item.kind === kind) ?? null;

// 증거 주소 생성
const source = (analysisId: string, evidenceId: string) =>
  `/api/analyses/${analysisId}/evidence/${evidenceId}`;

export function SceneView({ analysis }: Readonly<{ analysis: AnalysisView }>) {
  // 제외 후보는 서버에서 목록을 만들 때 제거되며 이 컴포넌트는 남은 결과만 재생한다
  // 완료된 범위 평가를 우선 보여주되 이후 사용자가 선택한 위치는 유지한다
  const [index, setIndex] = useState(() => {
    const completed = analysis.candidates.findIndex((candidate) =>
      candidate.varScopeEvaluation?.kind === "COMPETITION_VAR_SCOPE" && candidate.varScopeEvaluation.status === "COMPLETED");
    if (completed >= 0) return completed;
    return Math.max(0, analysis.candidates.findIndex((candidate) =>
      analysis.diagnostics
        ? candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED"
        : candidate.filter?.situation === "CORNER_KICK" && (candidate.filter.status === "OBSERVED" || candidate.filter.status === "APPLICABLE")));
  });
  // 마지막 후보 위치 계산
  const last = analysis.candidates.length - 1;
  // 현재 후보 선택
  const candidate = analysis.candidates[index] ?? null;

  // 장면 위치 제한
  const select = useCallback((value: number) => {
    setIndex(Math.max(0, Math.min(value, last)));
  }, [last]);

  // 키보드 장면 이동
  const key = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); select(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); select(index + 1); }
  }, [index, select]);

  if (analysis.status === "FAILED" || analysis.stage === "FAILED" || analysis.failureCode) return <section className="scene-gallery empty">
    <h2>영상 처리를 완료하지 못했습니다</h2>
    <p>처리 오류로 완료된 분석 결과를 제공할 수 없습니다. 파울이 없다는 판정은 아닙니다</p>
  </section>;
  if (analysis.resultPolicy === "COMPLETED_ONLY" && !candidate) return <section className="scene-gallery empty">
    <h2>완료된 분석 결과가 없습니다</h2>
    <p>이번 영상에서 규정 평가를 완료한 장면이 없습니다. 파울이 없다는 판정은 아닙니다</p>
  </section>;

  // 후보 장면 없음 표시
  if (!candidate) return <section className="scene-gallery empty">
    <h2>{analysis.diagnostics ? "인식된 코너킥 장면이 없습니다" : "탐지된 주요 장면이 없습니다"}</h2>
    {analysis.diagnostics ? <p>현재 인식 범위는 코너킥 장면입니다. 다른 사건이나 파울이 없다는 뜻은 아닙니다</p> : null}
  </section>;

  const frame = media(candidate, "FRAME");
  // 현재 후보의 클립 선택
  const clip = media(candidate, "CLIP");
  // 현재 후보의 대표 프레임 주소 생성
  const frameSource = frame ? source(analysis.analysisId, frame.evidenceId) : undefined;
  const scope = candidate.varScopeEvaluation;
  const completedGoalScope = scope?.kind === "COMPETITION_VAR_SCOPE" && scope.status === "COMPLETED" && scope.topic === "GOAL_RELATED";
  const sceneLabel = completedGoalScope ? "득점 관련 장면" : candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED" ? "코너킥 장면" : "후보 장면";
  const evidenceUnavailable = Boolean(analysis.diagnostics) && sceneLabel === "코너킥 장면" && candidate.filter?.reasonCodes.includes("EVIDENCE_UNAVAILABLE");

  return (
    <section className="scene-gallery" aria-label="장면 캐러셀" tabIndex={0} onKeyDown={key}>
      <div className="gallery-main">
        <div className="scene-stage">
          <div className="scene-media">
            {/* 클립과 프레임과 준비 문구 중 하나 표시 */}
            {clip ? <video key={clip.evidenceId} controls preload="metadata" poster={frameSource} src={source(analysis.analysisId, clip.evidenceId)} /> : frameSource ? <img src={frameSource} alt={`${sceneLabel} ${String(index + 1).padStart(2, "0")} 핵심 프레임`} /> : <p>{evidenceUnavailable ? "영상 근거 제공 불가" : "영상 준비 중"}</p>}
          </div>
          <div className="scene-caption">
            <div><span>선택 장면</span><strong>{sceneLabel} {String(index + 1).padStart(2, "0")}</strong></div>
            <nav className="scene-controls" aria-label="장면 이동">
              {/* 이전 후보 이동 버튼 */}
              <button type="button" aria-label="이전 장면" disabled={index === 0} onClick={() => select(index - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
              <span>{String(index + 1).padStart(2, "0")} / {String(analysis.candidates.length).padStart(2, "0")}</span>
              {/* 다음 후보 이동 버튼 */}
              <button type="button" aria-label="다음 장면" disabled={index === last} onClick={() => select(index + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
            </nav>
          </div>
        </div>
        <SceneList analysisId={analysis.analysisId} candidates={analysis.candidates} active={index} onSelect={select} />
      </div>
      <RulePanel analysis={analysis} candidate={candidate} />
    </section>
  );
}
