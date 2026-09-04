import * as React from "react";
import type { AnalysisView, CandidateView, JudgmentView } from "@replay/application";

const decision = (value: JudgmentView["decision"]): string => {
  switch (value) {
    case "FOUL": return "파울 가능성 있음";
    case "NO_FOUL": return "파울 근거 없음";
    case "NORMAL_CONTACT": return "정상적인 접촉 가능성";
    case "INCONCLUSIVE": return "판정 보류";
    case "OUT_OF_SCOPE": return "검토 범위 밖";
  }
};

const CitationList = ({ citations }: Readonly<{ citations: JudgmentView["citations"] }>) => citations.length === 0
  ? <p className="rule-empty">연결된 조항 없음</p>
  : <ul className="citation-list">{citations.map((citation) => (
      <li key={citation.ruleId}>
        <strong>{citation.law} {citation.section}</strong>
        <p>{citation.quoteSnapshot}</p>
        {citation.sourceUrl ? <a href={citation.sourceUrl} target="_blank" rel="noreferrer">원문 보기</a> : null}
      </li>
    ))}</ul>;

export function RulePanel({ analysis, candidate }: Readonly<{ analysis: AnalysisView; candidate: CandidateView }>) {
  const judgment = candidate.judgment;
  if (!judgment) {
    return (
      <section className="rule-panel pending" aria-label="규정 대조">
        <div><p>규정 대조</p><h2>영상 사실 추출 대기</h2></div>
        <p>접촉과 강도와 사건 범주가 확인되면 IFAB와 K리그 적용 조항을 표시합니다</p>
      </section>
    );
  }

  const ifab = judgment.citations.filter((citation) => citation.authority === "IFAB");
  const kleague = judgment.citations.filter((citation) => citation.authority === "KLEAGUE");
  const facts = judgment.facts.push;

  return (
    <div className="rule-panel">
      <header className="rule-heading">
        <div><p>선택 장면 규정 대조</p><h2>{decision(judgment.decision)}</h2></div>
        <span>{analysis.rule ? `${analysis.rule.competition} ${analysis.rule.season} · IFAB ${analysis.rule.ifabEdition}` : "규정 판본 미확인"}</span>
      </header>
      <div className="rule-grid">
        <section aria-label="확인된 사실">
          <h3>확인된 사실</h3>
          <dl className="fact-grid">
            <div><dt>접촉</dt><dd>{facts.contactDetected.value ? "확인" : "없음"}</dd></div>
            <div><dt>강도</dt><dd>{facts.severity.value}</dd></div>
            <div><dt>밀림</dt><dd>{facts.opponentDisplacement.value}</dd></div>
            <div><dt>관측 속도</dt><dd>{facts.severity.observedAtSpeed}</dd></div>
          </dl>
        </section>
        <section aria-label="IFAB 규정"><h3>IFAB 규정</h3><CitationList citations={ifab} /></section>
        <section aria-label="K리그 대회요강"><h3>K리그 대회요강</h3><CitationList citations={kleague} /></section>
        <section className="var-panel" aria-label="VAR 검토">
          <h3>VAR 검토</h3>
          <dl className="var-grid">
            <div><dt>검토 범위</dt><dd>{judgment.varAssessment.reviewable ? "해당" : "해당 없음"}</dd></div>
            <div><dt>재개 시한</dt><dd>{judgment.varAssessment.withinTimeWindow ? "검토 가능" : "종료"}</dd></div>
            <div><dt>문턱</dt><dd>{judgment.varAssessment.thresholdMet}</dd></div>
            <div><dt>절차</dt><dd>{judgment.varAssessment.reviewProcedure}</dd></div>
          </dl>
          <p>{judgment.varAssessment.explanation}</p>
        </section>
      </div>
    </div>
  );
}
