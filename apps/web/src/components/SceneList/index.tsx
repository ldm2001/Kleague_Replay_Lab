import { memo, useEffect, useRef } from "react";
import * as React from "react";
import type { CandidateView } from "@replay/application";

type SceneListProps = Readonly<{
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

// 밀리초를 시간 문구로 변환
const time = (value: number): string => {
  // 음수 시간을 0초로 보정
  const seconds = Math.max(0, Math.floor(value / 1000));
  // 분과 초 형식 생성
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const SceneRow = memo(function SceneRow({ analysisId, candidate, index, active, onSelect }: SceneRowProps) {
  // 활성 행 참조
  const row = useRef<HTMLLIElement>(null);
  // 대표 프레임 선택
  const frame = candidate.evidence?.find((item) => item.kind === "FRAME");
  const scope = candidate.varScopeEvaluation;
  const scopeCompleted = scope?.kind === "COMPETITION_VAR_SCOPE" && scope.status === "COMPLETED";
  const cornerObserved = candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED";
  const cornerEvidenceUnavailable = !scopeCompleted && cornerObserved && candidate.filter?.status === "UNDETERMINED" &&
    candidate.filter.reasonCodes.includes("EVIDENCE_UNAVAILABLE");
  const sceneLabel = scopeCompleted && scope.topic === "GOAL_RELATED" ? "득점 관련 장면" : cornerObserved ? "코너킥 장면" : "후보 장면";
  const filterLabel = scopeCompleted ? "범위 평가 완료" : candidate.filter ? {
    EXCLUDED: "표시 대상 제외",
    UNDETERMINED: cornerEvidenceUnavailable ? "영상 근거 제공 불가" : "규정 판단 근거 부족",
    OBSERVED: "재개 장면 관찰 · 참고 규정",
    APPLICABLE: "검토할 규정 연결",
  }[candidate.filter.status] : "파이프라인 후보";

  useEffect(() => {
    // 활성 후보를 목록 안에서 보이도록 이동
    if (active && typeof row.current?.scrollIntoView === "function") {
      row.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <li ref={row}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={`${sceneLabel} ${String(index + 1).padStart(2, "0")} ${time(candidate.startMs)}부터 ${time(candidate.endMs)}`}
        onClick={() => onSelect(index)}
      >
        {/* 후보 대표 프레임 표시 */}
        <span className="rail-thumb">
          {frame ? <img src={`/api/analyses/${analysisId}/evidence/${frame.evidenceId}`} alt="" loading="lazy" decoding="async" /> : <span>{cornerEvidenceUnavailable ? "영상 근거 없음" : "프레임 준비 중"}</span>}
        </span>
        {/* 후보 시간과 판정 상태 표시 */}
        <span className="rail-copy">
          <strong>{sceneLabel} {String(index + 1).padStart(2, "0")}</strong>
          <small>{time(candidate.startMs)}부터 {time(candidate.endMs)}</small>
          <em>{filterLabel}</em>
        </span>
        {/* 완료 범위 평가와 재개 장면은 변화 신호 점수로 표시하지 않는다 */}
        {scopeCompleted ? <span className="rail-score">범위 평가</span> : cornerObserved ? <span className="rail-score">재개</span> : <span className="rail-score" aria-label="화면 변화 점수이며 파울 확률이 아님">{candidate.signalScore === null ? "—" : `${Math.round(candidate.signalScore * 100)}%`}</span>}
      </button>
    </li>
  );
});

export function SceneList({ analysisId, candidates, active, onSelect }: SceneListProps) {
  // 후보 장면 목록 표시
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
