import * as React from "react";
import type { AnalysisView, CandidateView, JudgmentView } from "@replay/application";
import type { PipelineFilterReason } from "@replay/shared-types";

const filterReasons: Record<PipelineFilterReason, string> = {
  INVALID_INTERVAL: "유효하지 않은 영상 구간이어서 표시 대상에서 제외됐습니다",
  EVIDENCE_UNAVAILABLE: "이 장면의 영상 근거를 제공할 수 없습니다",
  RULE_CONTEXT_UNVERIFIED: "경기와 적용 규정 판본이 확인되지 않았습니다",
  INCIDENT_UNCLASSIFIED: "화면 변화 후보이며 사건 유형은 확인되지 않았습니다",
  CONTACT_UNOBSERVED: "현재 파이프라인은 신체 접촉을 확인하지 않습니다",
  INTENSITY_UNOBSERVED: "현재 파이프라인은 접촉 강도를 측정하지 않습니다",
};
// 내부 판정 어휘의 화면 표기
const labels: Record<string, string> = {
  CARELESS: "부주의", RECKLESS: "무모함", EXCESSIVE_FORCE: "과도한 힘", uncertain: "판단 보류", possible: "가능성 있음", clear: "명확함", none: "없음",
  NORMAL: "정상 속도", SLOW: "슬로모션", UNKNOWN: "미확인", MET: "충족", NOT_MET: "미충족", UNDETERMINED: "판단 보류", OFR: "주심 직접 검토", VAR_ONLY: "VAR 사실 확인", NONE: "해당 없음",
  CAMERA_INSUFFICIENT: "카메라 각도나 가림으로 판단 근거 부족", SLOW_MOTION_ONLY: "정상 속도에서 강도를 확인하지 못함", SEVERITY_UNDETERMINED: "접촉 강도나 밀림을 확정하지 못함", OUT_OF_SCOPE: "현재 규칙의 검토 범위 밖",
  MATCH: "규정 결과와 일치", MISMATCH: "규정 결과와 차이 있음",
  PLAY_CONTINUED: "경기 속행", DIRECT_FREE_KICK: "직접 프리킥", INDIRECT_FREE_KICK: "간접 프리킥", PENALTY_KICK: "페널티킥", DROP_BALL: "드롭볼", THROW_IN: "스로인", GOAL_KICK: "골킥", CORNER_KICK: "코너킥", KICK_OFF: "킥오프",
  ATTACKING_TEAM: "공격 팀", DEFENDING_TEAM: "수비 팀", CAUTION: "경고", SECOND_CAUTION: "두 번째 경고", SEND_OFF: "퇴장", GOAL: "득점 인정", NO_GOAL: "득점 불인정", NOT_APPLICABLE: "득점 상황 아님",
  RESTART_INFERRED: "재개 방식", REFEREE_SIGNAL: "주심 신호", VAR_OFR: "VAR 또는 OFR", USER_INPUT: "사용자 확인", MATCH_REPORT: "경기 보고서",
};

// 판정 문구 변환
const decision = (value: JudgmentView["decision"]): string => {
  switch (value) {
    case "FOUL": return "파울 가능성 있음";
    case "NO_FOUL": return "파울 근거 없음";
    case "NORMAL_CONTACT": return "정상적인 접촉 가능성";
    case "INCONCLUSIVE": return "판정 보류";
    case "OUT_OF_SCOPE": return "검토 범위 밖";
  }
};

// 규정 인용 한 건 표시
const Citation = ({ citation }: Readonly<{ citation: JudgmentView["citations"][number] }>) => <li>
  {/* 조항 식별자와 원문 요약 표시 */}
  <strong>{citation.law} {citation.section}</strong>
  <p>{citation.quoteSnapshot}</p>
  {citation.sourceUrl ? <a href={citation.sourceUrl} target="_blank" rel="noreferrer">원문 보기</a> : null}
</li>;

// 핵심 인용 세 건과 추가 조항 표시
const Citations = ({ citations }: Readonly<{ citations: JudgmentView["citations"] }>) => {
  // 긴 조항 목록을 핵심과 추가 항목으로 분리
  const primary = citations.slice(0, 3);
  const more = citations.slice(3);
  // 빈 인용 안내
  if (citations.length === 0) return <p className="rule-empty">연결된 조항 없음</p>;
  // 핵심 조항은 바로 표시하고 나머지는 요청할 때 펼침
  return <><ul className="citation-list">{primary.map((citation) => <Citation key={citation.ruleId} citation={citation} />)}</ul>
    {more.length > 0 ? <details className="citation-more"><summary>추가 조항 {more.length}개</summary><ul className="citation-list">{more.map((citation) => <Citation key={citation.ruleId} citation={citation} />)}</ul></details> : null}</>;
};

export function RulePanel({ analysis, candidate }: Readonly<{ analysis: AnalysisView; candidate: CandidateView }>) {
  const filter = candidate.filter;
  // 필터 결과가 있으면 이를 최종 표시 상태로 사용하고 과거 판정 데이터를 재평가하지 않는다
  if (filter) return (
    <section className="rule-panel pending" aria-label="규정 필터 결과">
      <div><p>규정 필터 결과</p><h2>{filter.status === "EXCLUDED" ? "표시 대상 제외" : "규정 판단 근거 부족"}</h2></div>
      <ul>{filter.reasonCodes.map((reason) => <li key={reason}>{filterReasons[reason] ?? "처리 근거를 확인할 수 없습니다"}</li>)}</ul>
      <p>파이프라인 결과에 대한 확인이며 파울 없음 판정을 의미하지 않습니다</p>
      {filter.ruleReferences.length > 0 ? <section aria-label="검토 기준 조항"><h3>검토 기준 조항</h3><Citations citations={filter.ruleReferences} /></section> : null}
      <small>필터 버전 · {filter.filterVersion}</small>
    </section>
  );
  // 선택 장면 판정 조회
  const judgment = candidate.judgment;
  if (!judgment) {
    // 과거 판정 데이터가 없는 후보는 현재 파이프라인의 근거 부족 상태로 표시
    return (
      <section className="rule-panel pending" aria-label="규정 대조">
        <div><p>규정 대조</p><h2>규정 판단 근거 부족</h2></div>
        <p>현재 파이프라인의 화면 변화 정보만으로는 접촉과 강도를 확인할 수 없습니다</p>
      </section>
    );
  }

  // IFAB 인용 분리
  const ifab = judgment.citations.filter((citation) => citation.authority === "IFAB");
  // K리그 인용 분리
  const kleague = judgment.citations.filter((citation) => citation.authority === "KLEAGUE");
  // 사실 묶음 선택
  const facts = judgment.facts.push;
  // 관측 판정 묶음 선택
  const observed = judgment.facts.observed;

  return (
    <div className="rule-panel">
      <header className="rule-heading">
        <div><p>선택 장면 규정 대조</p><h2>{decision(judgment.decision)}</h2></div>
        <span>{analysis.rule ? `${analysis.rule.competition} ${analysis.rule.season} · IFAB ${analysis.rule.ifabEdition}` : "규정 판본 미확인"}</span>
      </header>
      <div className="rule-grid">
        {/* 영상에서 확인된 사실 표시 */}
        <section aria-label="확인된 사실">
          <h3>확인된 사실</h3>
          <dl className="fact-grid">
            <div><dt>접촉</dt><dd>{facts.contactDetected.value ? "확인" : "없음"}</dd></div>
            <div><dt>강도</dt><dd>{labels[facts.severity.value]}</dd></div>
            <div><dt>밀림</dt><dd>{labels[facts.opponentDisplacement.value]}</dd></div>
            <div><dt>관측 속도</dt><dd>{labels[facts.severity.observedAtSpeed]}</dd></div>
          </dl>
          <p className="rule-empty">사실 출처 · {judgment.source === "USER" ? "사용자 확인" : judgment.source === "MODEL" ? "영상 모델" : "검수자 확인"}</p>
          {judgment.inconclusiveReason ? <p className="rule-empty">{labels[judgment.inconclusiveReason]}</p> : null}
        </section>
        {/* 관측된 원심과 규정 결과 비교 */}
        <section aria-label="관측 판정 비교">
          <h3>관측 판정 비교</h3>
          <dl className="fact-grid">
            <div><dt>경기 재개</dt><dd>{labels[observed.restartType]}</dd></div>
            <div><dt>재개 대상</dt><dd>{labels[observed.restartBeneficiary]}</dd></div>
            <div><dt>카드</dt><dd>{observed.card === null ? "미확인" : labels[observed.card]}</dd></div>
            <div><dt>득점 판정</dt><dd>{labels[observed.goalDecision]}</dd></div>
          </dl>
          <p className={`rule-match ${judgment.decisionMatch.toLowerCase()}`}>재개와 카드 비교 · {labels[judgment.decisionMatch]}</p>
          <p className="rule-empty">관측 출처 · {labels[observed.source]}</p>
        </section>
        {/* IFAB 규정 인용 표시 */}
        <section aria-label="IFAB 규정"><h3>IFAB 규정</h3><Citations citations={ifab} /></section>
        {/* K리그 대회요강 인용 표시 */}
        <section aria-label="K리그 대회요강"><h3>K리그 대회요강</h3><Citations citations={kleague} /></section>
        <section className="var-panel" aria-label="VAR 검토">
          <h3>VAR 검토</h3>
          <dl className="var-grid">
            <div><dt>검토 범위</dt><dd>{judgment.varAssessment.reviewable ? "해당" : "해당 없음"}</dd></div>
            <div><dt>재개 시한</dt><dd>{judgment.varAssessment.withinTimeWindow ? "검토 가능" : "종료"}</dd></div>
            <div><dt>명백한 오류 문턱</dt><dd>{labels[judgment.varAssessment.thresholdMet]}</dd></div>
            <div><dt>절차</dt><dd>{labels[judgment.varAssessment.reviewProcedure]}</dd></div>
          </dl>
          <p>{judgment.varAssessment.explanation}</p>
        </section>
      </div>
    </div>
  );
}
