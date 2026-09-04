"use client";

import { useCallback, useState } from "react";
import * as React from "react";
import type { AnalysisView, CandidateView } from "@replay/application";
import { RulePanel } from "../RulePanel";
import { SceneRail } from "../SceneRail";

const media = (candidate: CandidateView, kind: "FRAME" | "CLIP") =>
  candidate.evidence?.find((item) => item.kind === kind) ?? null;

const source = (analysisId: string, evidenceId: string) =>
  `/api/analyses/${analysisId}/evidence/${evidenceId}`;

export function SceneGallery({ analysis }: Readonly<{ analysis: AnalysisView }>) {
  const [index, setIndex] = useState(0);
  const last = analysis.candidates.length - 1;
  const candidate = analysis.candidates[index] ?? null;

  const select = useCallback((value: number) => {
    setIndex(Math.max(0, Math.min(value, last)));
  }, [last]);

  const key = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); select(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); select(index + 1); }
  }, [index, select]);

  if (!candidate) return <section className="scene-gallery empty"><h2>탐지된 주요 장면이 없습니다</h2></section>;

  const frame = media(candidate, "FRAME");
  const clip = media(candidate, "CLIP");
  const frameSource = frame ? source(analysis.analysisId, frame.evidenceId) : undefined;

  return (
    <section className="scene-gallery" aria-label="장면 캐러셀" tabIndex={0} onKeyDown={key}>
      <div className="gallery-main">
        <div className="scene-stage">
          <div className="scene-media">
            {clip ? <video key={clip.evidenceId} controls preload="metadata" poster={frameSource} src={source(analysis.analysisId, clip.evidenceId)} /> : frameSource ? <img src={frameSource} alt={`후보 장면 ${String(index + 1).padStart(2, "0")} 핵심 프레임`} /> : <p>영상 준비 중</p>}
          </div>
          <div className="scene-caption">
            <div><span>선택 장면</span><strong>후보 장면 {String(index + 1).padStart(2, "0")}</strong></div>
            <nav className="scene-controls" aria-label="장면 이동">
              <button type="button" aria-label="이전 장면" disabled={index === 0} onClick={() => select(index - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
              <span>{String(index + 1).padStart(2, "0")} / {String(analysis.candidates.length).padStart(2, "0")}</span>
              <button type="button" aria-label="다음 장면" disabled={index === last} onClick={() => select(index + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
            </nav>
          </div>
        </div>
        <SceneRail analysisId={analysis.analysisId} candidates={analysis.candidates} active={index} onSelect={select} />
      </div>
      <RulePanel analysis={analysis} candidate={candidate} />
    </section>
  );
}
