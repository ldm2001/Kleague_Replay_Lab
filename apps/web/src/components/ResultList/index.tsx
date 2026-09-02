import { memo } from "react";
import * as React from "react";
import type { MediaView } from "@replay/application";

type Analysis = NonNullable<MediaView["analysis"]>;

const time = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minute = Math.floor(seconds / 60).toString().padStart(2, "0");
  const second = (seconds % 60).toString().padStart(2, "0");
  return `${minute}:${second}`;
};

export const ResultList = memo(function ResultList({ analysis }: Readonly<{ analysis: Analysis }>) {
  const baseline = analysis.mode === "VISUAL_CHANGE_BASELINE";
  return (
    <section className="result-list" aria-label="분석 결과">
      <div className="result-heading">
        <div><p>{baseline ? "기초 장면 탐색 완료" : "판정 분석 완료"}</p><h3>{baseline ? "영상 변화 구간" : "후보 장면"} {analysis.candidates.length}건</h3></div>
        <span>{baseline ? "처리 완료" : `${analysis.progressPercent}%`}</span>
      </div>
      {analysis.candidates.length === 0 ? (
        <p className="result-empty">현재 기준으로 탐지된 후보 장면이 없습니다</p>
      ) : (
        <ol className="candidate-list">
          {analysis.candidates.map((candidate) => {
            const frame = candidate.evidence?.find((item) => item.kind === "FRAME");
            const clip = candidate.evidence?.find((item) => item.kind === "CLIP");
            return (
              <li key={candidate.index}>
                <div className="candidate-media">
                  {frame ? (
                    <img
                      src={`/api/analyses/${analysis.analysisId}/evidence/${frame.evidenceId}`}
                      alt={`후보 장면 ${String(candidate.index).padStart(2, "0")} 핵심 프레임`}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : <div className="media-empty">프레임 준비 중</div>}
                  {clip ? (
                    <video
                      aria-label={`후보 장면 ${String(candidate.index).padStart(2, "0")} 클립`}
                      controls
                      preload="metadata"
                      src={`/api/analyses/${analysis.analysisId}/evidence/${clip.evidenceId}`}
                    />
                  ) : null}
                </div>
                <div className="candidate-copy">
                  <div>
                    <strong>후보 장면 {String(candidate.index).padStart(2, "0")}</strong>
                    <span>{time(candidate.startMs)}부터 {time(candidate.endMs)}</span>
                  </div>
                  <dl>
                    <div><dt>{baseline ? "변화 신호" : "탐지 신뢰도"}</dt><dd>{candidate.signalScore === null ? "미확인" : `${Math.round(candidate.signalScore * 100)}%`}</dd></div>
                    {!baseline ? <div><dt>카메라</dt><dd>{candidate.cameraSufficiency}</dd></div> : null}
                  </dl>
                  {analysis.judgmentStatus === "NOT_EVALUATED" ? <span className="candidate-state">판정 미평가</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {analysis.limitations.length > 0 ? (
        <div className="result-limits">
          <strong>현재 분석 한계</strong>
          <ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
});
