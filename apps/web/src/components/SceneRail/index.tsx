import { memo, useEffect, useRef } from "react";
import * as React from "react";
import type { CandidateView } from "@replay/application";

type SceneRailProps = Readonly<{
  analysisId: string;
  candidates: readonly CandidateView[];
  active: number;
  onSelect: (index: number) => void;
}>;

type SceneRowProps = Readonly<{
  analysisId: string;
  candidate: CandidateView;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}>;

const time = (value: number): string => {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const SceneRow = memo(function SceneRow({ analysisId, candidate, index, active, onSelect }: SceneRowProps) {
  const row = useRef<HTMLLIElement>(null);
  const frame = candidate.evidence?.find((item) => item.kind === "FRAME");

  useEffect(() => {
    if (active && typeof row.current?.scrollIntoView === "function") {
      row.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <li ref={row}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={`후보 장면 ${String(index + 1).padStart(2, "0")} ${time(candidate.startMs)}부터 ${time(candidate.endMs)}`}
        onClick={() => onSelect(index)}
      >
        <span className="rail-thumb">
          {frame ? <img src={`/api/analyses/${analysisId}/evidence/${frame.evidenceId}`} alt="" loading="lazy" decoding="async" /> : <span>프레임 준비 중</span>}
        </span>
        <span className="rail-copy">
          <strong>후보 장면 {String(index + 1).padStart(2, "0")}</strong>
          <small>{time(candidate.startMs)}부터 {time(candidate.endMs)}</small>
          <em>{candidate.judgment ? "규정 대조 완료" : "영상 사실 추출 대기"}</em>
        </span>
        <span className="rail-score">{candidate.signalScore === null ? "—" : `${Math.round(candidate.signalScore * 100)}%`}</span>
      </button>
    </li>
  );
});

export function SceneRail({ analysisId, candidates, active, onSelect }: SceneRailProps) {
  return (
    <aside className="rail-panel" aria-label="전체 후보 장면">
      <header><strong>주요 장면</strong><span>{candidates.length}건</span></header>
      <ol className="scene-rail">
        {candidates.map((candidate, index) => (
          <SceneRow key={candidate.id} analysisId={analysisId} candidate={candidate} index={index} active={index === active} onSelect={onSelect} />
        ))}
      </ol>
    </aside>
  );
}
