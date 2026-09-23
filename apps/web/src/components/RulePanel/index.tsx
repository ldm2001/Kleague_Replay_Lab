// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import type { AnalysisView, CandidateView, JudgmentView } from "@replay/application";
import type { PipelineFilterReason } from "@replay/shared-types";

// 규정 필터 사유별 사용자 안내 문구 연결
const filterReasons: Record<PipelineFilterReason, string> = {
    // 재개 사건의 시간과 근거 오류 상태의 안내 문구 연결
    INVALID_SCENE_EVENT: "재개 장면의 시간 범위나 관찰 근거가 맞지 않아 제외됐습니다",
    // 재개 사건 관측 근거 부재 상태의 안내 문구 연결
    SCENE_EVENT_UNAVAILABLE: "세트피스의 시간대별 관찰 근거가 없습니다",
    // 코너킥 재개 장면 관측 상태의 안내 문구 연결
    SITUATION_OBSERVED: "영상에서 코너킥 재개 장면이 관찰됐습니다",
    // 해당 판본의 참고 규정 부재 상태의 안내 문구 연결
    RULE_CLAUSES_UNAVAILABLE: "이 판본에 연결된 코너킥 검토 조항이 없습니다",
    // 공 후보 추적 범위 오류 상태의 안내 문구 연결
    INVALID_TRACKING: "추적 결과의 범위가 맞지 않아 제외됐습니다",
    // 공 후보 추적 경로 부재 상태의 안내 문구 연결
    TRACKING_UNAVAILABLE: "이 구간에서는 공 후보 경로를 확보하지 못했습니다",
    // 영상 일부의 추적만 확보 상태의 안내 문구 연결
    TRACKING_INCOMPLETE: "영상 일부의 추적 결과만 있어 추가 판단을 보류했습니다",
    // 카메라 움직임 보정 미확인 상태의 안내 문구 연결
    CAMERA_MOTION_UNVERIFIED: "공 후보의 화면 위치는 이어졌지만 카메라 움직임 보정은 확인되지 않았습니다",
    // 영상 구간 범위 오류 상태의 안내 문구 연결
    INVALID_INTERVAL: "유효하지 않은 영상 구간이어서 표시 대상에서 제외됐습니다",
    // 장면 영상 근거 제공 불가 상태의 안내 문구 연결
    EVIDENCE_UNAVAILABLE: "이 장면의 영상 근거를 제공할 수 없습니다",
    // 경기와 규정 판본 미확인 상태의 안내 문구 연결
    RULE_CONTEXT_UNVERIFIED: "경기와 적용 규정 판본이 확인되지 않았습니다",
    // 사건 유형 미확인 상태의 안내 문구 연결
    INCIDENT_UNCLASSIFIED: "화면 변화 후보이며 사건 유형은 확인되지 않았습니다",
    // 신체 접촉 관측 미지원 상태의 안내 문구 연결
    CONTACT_UNOBSERVED: "현재 파이프라인은 신체 접촉을 확인하지 않습니다",
    // 접촉 강도 측정 미지원 상태의 안내 문구 연결
    INTENSITY_UNOBSERVED: "현재 파이프라인은 접촉 강도를 측정하지 않습니다",
};
// 내부 판정 어휘의 화면 표기
const labels: Record<string, string> = {
    // 판단에 필요한 사실이 확인되지 않음 의미의 내부 코드를 화면 문구에 연결
    FACTS_UNDETERMINED: "판단에 필요한 사실이 확인되지 않음",
    // 현재 규칙 엔진이 지원하지 않는 경기 상황 의미의 내부 코드를 화면 문구에 연결
    CONTEXT_UNSUPPORTED: "현재 규칙 엔진이 지원하지 않는 경기 상황",
    // 부주의 의미의 내부 코드를 화면 문구에 연결
    CARELESS: "부주의",
    // 무모함 의미의 내부 코드를 화면 문구에 연결
    RECKLESS: "무모함",
    // 과도한 힘 의미의 내부 코드를 화면 문구에 연결
    EXCESSIVE_FORCE: "과도한 힘",
    // 판단 보류 의미의 내부 코드를 화면 문구에 연결
    uncertain: "판단 보류",
    // 가능성 있음 의미의 내부 코드를 화면 문구에 연결
    possible: "가능성 있음",
    // 명확함 의미의 내부 코드를 화면 문구에 연결
    clear: "명확함",
    // 없음 의미의 내부 코드를 화면 문구에 연결
    none: "없음",
    // 정상 속도 의미의 내부 코드를 화면 문구에 연결
    NORMAL: "정상 속도",
    // 슬로모션 의미의 내부 코드를 화면 문구에 연결
    SLOW: "슬로모션",
    // 미확인 의미의 내부 코드를 화면 문구에 연결
    UNKNOWN: "미확인",
    // 충족 의미의 내부 코드를 화면 문구에 연결
    MET: "충족",
    // 미충족 의미의 내부 코드를 화면 문구에 연결
    NOT_MET: "미충족",
    // 판단 보류 의미의 내부 코드를 화면 문구에 연결
    UNDETERMINED: "판단 보류",
    // 주심 직접 검토 의미의 내부 코드를 화면 문구에 연결
    OFR: "주심 직접 검토",
    // 비디오 판독 사실 확인 의미의 내부 코드를 화면 문구에 연결
    VAR_ONLY: "VAR 사실 확인",
    // 해당 없음 의미의 내부 코드를 화면 문구에 연결
    NONE: "해당 없음",
    // 카메라 각도나 가림으로 판단 근거 부족 의미의 내부 코드를 화면 문구에 연결
    CAMERA_INSUFFICIENT: "카메라 각도나 가림으로 판단 근거 부족",
    // 정상 속도에서 강도를 확인하지 못함 의미의 내부 코드를 화면 문구에 연결
    SLOW_MOTION_ONLY: "정상 속도에서 강도를 확인하지 못함",
    // 접촉 강도나 밀림을 확정하지 못함 의미의 내부 코드를 화면 문구에 연결
    SEVERITY_UNDETERMINED: "접촉 강도나 밀림을 확정하지 못함",
    // 현재 규칙의 검토 범위 밖 의미의 내부 코드를 화면 문구에 연결
    OUT_OF_SCOPE: "현재 규칙의 검토 범위 밖",
    // 규정 결과와 일치 의미의 내부 코드를 화면 문구에 연결
    MATCH: "규정 결과와 일치",
    // 규정 결과와 차이 있음 의미의 내부 코드를 화면 문구에 연결
    MISMATCH: "규정 결과와 차이 있음",
    // 경기 속행 의미의 내부 코드를 화면 문구에 연결
    PLAY_CONTINUED: "경기 속행",
    // 직접 프리킥 의미의 내부 코드를 화면 문구에 연결
    DIRECT_FREE_KICK: "직접 프리킥",
    // 간접 프리킥 의미의 내부 코드를 화면 문구에 연결
    INDIRECT_FREE_KICK: "간접 프리킥",
    // 페널티킥 의미의 내부 코드를 화면 문구에 연결
    PENALTY_KICK: "페널티킥",
    // 드롭볼 의미의 내부 코드를 화면 문구에 연결
    DROP_BALL: "드롭볼",
    // 스로인 의미의 내부 코드를 화면 문구에 연결
    THROW_IN: "스로인",
    // 골킥 의미의 내부 코드를 화면 문구에 연결
    GOAL_KICK: "골킥",
    // 코너킥 의미의 내부 코드를 화면 문구에 연결
    CORNER_KICK: "코너킥",
    // 킥오프 의미의 내부 코드를 화면 문구에 연결
    KICK_OFF: "킥오프",
    // 공격 팀 의미의 내부 코드를 화면 문구에 연결
    ATTACKING_TEAM: "공격 팀",
    // 수비 팀 의미의 내부 코드를 화면 문구에 연결
    DEFENDING_TEAM: "수비 팀",
    // 경고 의미의 내부 코드를 화면 문구에 연결
    CAUTION: "경고",
    // 두 번째 경고 의미의 내부 코드를 화면 문구에 연결
    SECOND_CAUTION: "두 번째 경고",
    // 퇴장 의미의 내부 코드를 화면 문구에 연결
    SEND_OFF: "퇴장",
    // 득점 인정 의미의 내부 코드를 화면 문구에 연결
    GOAL: "득점 인정",
    // 득점 불인정 의미의 내부 코드를 화면 문구에 연결
    NO_GOAL: "득점 불인정",
    // 득점 상황 아님 의미의 내부 코드를 화면 문구에 연결
    NOT_APPLICABLE: "득점 상황 아님",
    // 재개 방식 의미의 내부 코드를 화면 문구에 연결
    RESTART_INFERRED: "재개 방식",
    // 주심 신호 의미의 내부 코드를 화면 문구에 연결
    REFEREE_SIGNAL: "주심 신호",
    // 비디오 판독 또는 의미의 내부 코드를 화면 문구에 연결
    VAR_OFR: "VAR 또는 OFR",
    // 사용자 확인 의미의 내부 코드를 화면 문구에 연결
    USER_INPUT: "사용자 확인",
    // 경기 보고서 의미의 내부 코드를 화면 문구에 연결
    MATCH_REPORT: "경기 보고서"
};

// 판정 문구 변환
const decision = (value: JudgmentView["decision"]): string => {
    // 판정 종류에 따라 사용자 안내 문구 분기
    switch (value) {
        // 파울 가능성 안내 반환
        case "FOUL": return "파울 가능성 있음";
        // 파울 근거 없음 안내 반환
        case "NO_FOUL": return "파울 근거 없음";
        // 정상 접촉 가능성 안내 반환
        case "NORMAL_CONTACT": return "정상적인 접촉 가능성";
        // 판정 보류 안내 반환
        case "INCONCLUSIVE": return "판정 보류";
        // 검토 범위 밖 안내 반환
        case "OUT_OF_SCOPE": return "검토 범위 밖";
    }
};

// 규정 인용 한 건 표시
const Citation = ({ citation }: Readonly<{ citation: JudgmentView["citations"][number] }>) => (
    // 규정 대조의 목록 항목 표시
    <li>
        {/* 조항 식별자와 원문 요약 표시 */}
        <strong>
            {citation.law} {citation.section}
        </strong>
        {/* 규정 대조의 안내 문구 표시 */}
        <p>{citation.quoteSnapshot}</p>
        {citation.sourceUrl ? (
            // 원문 보기의 이동 링크 표시
            <a href={citation.sourceUrl} target="_blank" rel="noreferrer">
                원문 보기
            </a>
        ) : null}
    </li>
);

// 핵심 인용 세 건과 추가 조항 표시
const Citations = ({ citations }: Readonly<{ citations: JudgmentView["citations"] }>) => {
    // 긴 조항 목록을 핵심과 추가 항목으로 분리
    const primary = citations.slice(0, 3);
    // 처음 세 건을 제외한 추가 인용 조항 선택
    const more = citations.slice(3);
    // 빈 인용 안내
    if (citations.length === 0) return <p className="rule-empty">연결된 조항 없음</p>;
    // 핵심 조항은 바로 표시하고 나머지는 요청할 때 펼침
    return (
        <>
            {/* 근거 규정 인용 목록의 순서 없는 목록 표시 */}
            <ul className="citation-list">
                {primary.map((citation) => (
                    // 규정 인용 한 건 표시
                    <Citation key={citation.ruleId} citation={citation} />
                ))}
            </ul>
            {more.length > 0 ? (
                // 추가 인용 규정의 접을 수 있는 추가 정보 표시
                <details className="citation-more">
                    {/* 추가 조항 개의 추가 정보 펼침 제목 표시 */}
                    <summary>추가 조항 {more.length}개</summary>
                    {/* 근거 규정 인용 목록의 순서 없는 목록 표시 */}
                    <ul className="citation-list">
                        {more.map((citation) => (
                            // 규정 인용 한 건 표시
                            <Citation key={citation.ruleId} citation={citation} />
                        ))}
                    </ul>
                </details>
            ) : null}
        </>
    );
};

// 화면 요소 구성
export function RulePanel({
    analysis,
    candidate
}: Readonly<{ analysis: AnalysisView; candidate: CandidateView }>) {
    // 선택 후보의 비디오 판독 범위 평가 읽음
    const scope = candidate.varScopeEvaluation;
    // 선택 후보의 자동 규정 평가 읽음
    const automatic = candidate.automaticJudgment;
    // 자동 규정 평가를 완료한 결과인지 확인
    if (automatic?.status === "COMPLETED") {
        // 현재 상태에 맞는 규정 평가와 인용 화면 반환
        return (
            <section className="rule-panel" aria-label="완료된 밀기 규정 평가">
                {/* 선택 장면 규정 평가 제목의 제목 영역 표시 */}
                <header className="rule-heading">
                    {/* 규정 대조의 화면 묶음 표시 */}
                    <div>
                        {/* 자동 규정 평가의 안내 문구 표시 */}
                        <p>자동 규정 평가</p>
                        {/* 밀기 규정 평가 완료의 구역 제목 표시 */}
                        <h2>밀기 규정 평가 완료</h2>
                    </div>
                    {/* ·의 짧은 문구 표시 */}
                    <span>
                        {automatic.rule.competition} {automatic.rule.season} ·{" "}
                        {automatic.rule.ifabVersionId}
                    </span>
                </header>
                {/* 규정 대조의 안내 문구 표시 */}
                <p>
                    {automatic.result.decision === "FOUL"
                        ? "이 장면의 밀기는 반칙에 해당합니다"
                        : "이 장면에서 밀기 반칙은 성립하지 않습니다"}
                </p>
                {/* 확인 사실과 판정 항목의 항목 설명 목록 표시 */}
                <dl className="fact-grid">
                    {/* 규정 대조의 화면 묶음 표시 */}
                    <div>
                        {/* 재개의 항목 이름 표시 */}
                        <dt>재개</dt>
                        {/* 규정 대조의 항목 설명 표시 */}
                        <dd>{labels[automatic.result.restart ?? "UNKNOWN"]}</dd>
                    </div>
                    {/* 규정 대조의 화면 묶음 표시 */}
                    <div>
                        {/* 징계의 항목 이름 표시 */}
                        <dt>징계</dt>
                        {/* 규정 대조의 항목 설명 표시 */}
                        <dd>
                            {automatic.result.disciplinary === "NONE"
                                ? "카드 없음"
                                : labels[automatic.result.disciplinary ?? "UNKNOWN"]}
                        </dd>
                    </div>
                </dl>
                {/* 규정 대조의 안내 문구 표시 */}
                <p>
                    지원하는 밀기 규정에 대한 평가입니다. 다른 파울 유형과 원심의 정확성, 득점 및
                    VAR 개입 여부는 평가하지 않았습니다
                </p>
                {/* 규정 인용 목록 표시 */}
                <Citations citations={automatic.result.citations} />
                {scope?.status === "COMPLETED" ? (
                    // 완료된 비디오 판독 범위 분석의 내용 구역 표시
                    <section aria-label="완료된 VAR 범위 분석">
                        {/* 비디오 판독 범위 분석의 항목 제목 표시 */}
                        <h3>VAR 범위 분석</h3>
                        {/* 규정 대조의 안내 문구 표시 */}
                        <p>{scope.explanation}</p>
                        {/* 규정 인용 목록 표시 */}
                        <Citations citations={scope.citations} />
                    </section>
                ) : null}
            </section>
        );
    }
    // 완료된 대회요강 범위 평가는 전체 파울 판단의 미완료 필터와 별도로 표시
    if (scope?.kind === "COMPETITION_VAR_SCOPE" && scope.status === "COMPLETED") {
        // 현재 상태에 맞는 규정 평가와 인용 화면 반환
        return (
            <section className="rule-panel" aria-label="완료된 VAR 범위 분석">
                {/* 선택 장면 규정 평가 제목의 제목 영역 표시 */}
                <header className="rule-heading">
                    {/* 규정 대조의 화면 묶음 표시 */}
                    <div>
                        {/* 완료된 비디오 판독 범위 분석의 안내 문구 표시 */}
                        <p>완료된 VAR 범위 분석</p>
                        {/* 규정 대조의 구역 제목 표시 */}
                        <h2>
                            {scope.topic === "GOAL_RELATED"
                                ? "득점 관련 VAR 검토 범위"
                                : "VAR 검토 범위"}
                        </h2>
                    </div>
                    {/* · 대회요강의 짧은 문구 표시 */}
                    <span>
                        {scope.competition} {scope.season} · 대회요강
                    </span>
                </header>
                {/* 확인 사실과 관측 판정 및 인용의 화면 묶음 표시 */}
                <div className="rule-grid">
                    {/* 범위 평가 결과의 내용 구역 표시 */}
                    <section aria-label="범위 평가 결과">
                        {/* 규정 대조의 항목 제목 표시 */}
                        <h3>
                            {scope.included
                                ? "대회요강의 적용 범주에 해당"
                                : "대회요강의 적용 범주에 해당하지 않음"}
                        </h3>
                        {/* 규정 대조 보충 안내의 안내 문구 표시 */}
                        <p className="rule-empty">{scope.question}</p>
                        {/* 규정 대조 보충 안내의 안내 문구 표시 */}
                        <p className="rule-empty">{scope.explanation}</p>
                    </section>
                    {/* 케이리그 대회요강의 내용 구역 표시 */}
                    <section aria-label="K리그 대회요강">
                        {/* 케이리그 대회요강의 항목 제목 표시 */}
                        <h3>K리그 대회요강</h3>
                        {/* 규정 인용 목록 표시 */}
                        <Citations citations={scope.citations} />
                    </section>
                    {/* 분석 근거의 내용 구역 표시 */}
                    <section className="var-panel" aria-label="분석 근거">
                        {/* 분석 근거의 항목 제목 표시 */}
                        <h3>분석 근거</h3>
                        {scope.topic === "GOAL_RELATED" ? (
                            // 중계의 표시가 관찰된 영상 구간의 안내 문구 표시
                            <p>중계의 GOAL 표시가 관찰된 영상 구간</p>
                        ) : null}
                        {/* 규정 대조의 안내 문구 표시 */}
                        <p>
                            제공된 대회요강의 적용 범주 분석이며 실제 득점 인정·VAR 실시·원심
                            오류·개입 필요성을 뜻하지 않습니다
                        </p>
                        {/* 검토 시한과 규정 판본 채택의 미평가 범위 안내 표시 */}
                        <p>검토 시한과 IFAB 판본 채택 여부는 평가하지 않습니다</p>
                    </section>
                </div>
            </section>
        );
    }
    // 선택 후보의 규정 필터 결과 읽음
    const filter = candidate.filter;
    // 서버가 선택한 상황과 검토 조건을 표시하고 미확인 조건을 충족으로 바꾸지 않음
    if (
        filter &&
        (filter.status === "OBSERVED" || filter.status === "APPLICABLE") &&
        filter.situation === "CORNER_KICK"
    ) {
        // 현재 상태에 맞는 규정 평가와 인용 화면 반환
        return (
            <section className="rule-panel pending" aria-label="규정 필터 결과">
                {/* 규정 대조의 화면 묶음 표시 */}
                <div>
                    {/* 규정 필터 결과의 안내 문구 표시 */}
                    <p>규정 필터 결과</p>
                    {/* 코너킥 장면의 구역 제목 표시 */}
                    <h2>코너킥 장면</h2>
                </div>
                {/* 규정 대조의 안내 문구 표시 */}
                <p>
                    {filter.referenceOnly
                        ? filter.reasonCodes.includes("RULE_CLAUSES_UNAVAILABLE")
                            ? "코너킥 조항 미연결 · 참고 규정"
                            : "적용 판본 미확정 · 참고 규정"
                        : "검증된 적용 판본 · 검토 규정"}
                </p>
                {/* 규정 대조의 순서 없는 목록 표시 */}
                <ul>
                    {filter.reasonCodes.map((reason) => (
                        // 규정 대조의 목록 항목 표시
                        <li key={reason}>
                            {filterReasons[reason] ?? "처리 근거를 확인할 수 없습니다"}
                        </li>
                    ))}
                </ul>
                {/* 코너킥 검토 조건의 내용 구역 표시 */}
                <section aria-label="코너킥 검토 조건">
                    {/* 검토할 규정 조건의 항목 제목 표시 */}
                    <h3>검토할 규정 조건</h3>
                    {/* 근거 규정 인용 목록의 순서 없는 목록 표시 */}
                    <ul className="citation-list">
                        {filter.conditions?.map((condition) => (
                            // 규정 대조의 목록 항목 표시
                            <li key={condition.code}>
                                {/* · 조건 미확인의 강조 문구 표시 */}
                                <strong>
                                    Law {condition.law}.{condition.section} · 조건 미확인
                                </strong>
                                {/* 규정 대조의 안내 문구 표시 */}
                                <p>{condition.description}</p>
                                {/* 규정 대조의 이동 링크 표시 */}
                                <a href={condition.sourceUrl} target="_blank" rel="noreferrer">
                                    {filter.referenceOnly
                                        ? "참고 원문 보기"
                                        : "적용 판본 원문 보기"}
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
                {/* 영상 근거 부족으로 조건 충족을 확정할 수 없는 한계 표시 */}
                <p>현재 영상 근거로는 각 조건의 충족 여부를 확정할 수 없습니다</p>
                {filter.ruleReferences.length > 0 ? (
                    // 검토 기준 조항의 내용 구역 표시
                    <section aria-label="검토 기준 조항">
                        {/* 검토 기준 조항의 항목 제목 표시 */}
                        <h3>검토 기준 조항</h3>
                        {/* 규정 인용 목록 표시 */}
                        <Citations citations={filter.ruleReferences} />
                    </section>
                ) : null}
                {/* 필터 버전 ·의 보조 문구 표시 */}
                <small>필터 버전 · {filter.filterVersion}</small>
            </section>
        );
    }
    // 새 결과에서는 장면 인식과 영상 근거 제공 여부를 구분하되 서버 필터를 바꾸지 않음
    const recognizedCornerWithoutEvidence =
        "diagnostics" in analysis &&
        analysis.diagnostics != null &&
        candidate.sceneEvent?.kind === "CORNER_KICK" &&
        candidate.sceneEvent.status === "OBSERVED" &&
        filter?.status === "UNDETERMINED" &&
        filter.reasonCodes.includes("EVIDENCE_UNAVAILABLE");
    // 필터 결과가 있으면 이를 최종 표시 상태로 사용하고 과거 판정 데이터를 재평가하지 않음
    if (filter) {
        // 현재 상태에 맞는 규정 평가와 인용 화면 반환
        return (
            <section className="rule-panel pending" aria-label="규정 필터 결과">
                {/* 규정 대조의 화면 묶음 표시 */}
                <div>
                    {/* 규정 필터 결과의 안내 문구 표시 */}
                    <p>규정 필터 결과</p>
                    {/* 규정 대조의 구역 제목 표시 */}
                    <h2>
                        {recognizedCornerWithoutEvidence
                            ? "코너킥 장면"
                            : filter.status === "EXCLUDED"
                              ? "표시 대상 제외"
                              : "규정 판단 근거 부족"}
                    </h2>
                </div>
                {recognizedCornerWithoutEvidence ? <p>영상 근거 제공 불가</p> : null}
                {/* 규정 대조의 순서 없는 목록 표시 */}
                <ul>
                    {filter.reasonCodes.map((reason) => (
                        // 규정 대조의 목록 항목 표시
                        <li key={reason}>
                            {filterReasons[reason] ?? "처리 근거를 확인할 수 없습니다"}
                        </li>
                    ))}
                </ul>
                {recognizedCornerWithoutEvidence && (filter.conditions?.length ?? 0) > 0 ? (
                    // 코너킥 검토 조건의 내용 구역 표시
                    <section aria-label="코너킥 검토 조건">
                        {/* 검토할 규정 조건의 항목 제목 표시 */}
                        <h3>검토할 규정 조건</h3>
                        {/* 근거 규정 인용 목록의 순서 없는 목록 표시 */}
                        <ul className="citation-list">
                            {filter.conditions?.map((condition) => (
                                // 규정 대조의 목록 항목 표시
                                <li key={condition.code}>
                                    {/* · 조건 미확인의 강조 문구 표시 */}
                                    <strong>
                                        Law {condition.law}.{condition.section} · 조건 미확인
                                    </strong>
                                    {/* 규정 대조의 안내 문구 표시 */}
                                    <p>{condition.description}</p>
                                    {/* 규정 대조의 이동 링크 표시 */}
                                    <a href={condition.sourceUrl} target="_blank" rel="noreferrer">
                                        {filter.referenceOnly
                                            ? "참고 원문 보기"
                                            : "적용 판본 원문 보기"}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {recognizedCornerWithoutEvidence ? (
                    // 규정 대조의 안내 문구 표시
                    <p>코너킥 장면은 인식됐지만 IFAB 규정 조건의 충족 여부는 확인되지 않았습니다</p>
                ) : null}
                {/* 규정 대조의 안내 문구 표시 */}
                <p>파이프라인 결과에 대한 확인이며 파울 없음 판정을 의미하지 않습니다</p>
                {filter.ruleReferences.length > 0 ? (
                    // 검토 기준 조항의 내용 구역 표시
                    <section aria-label="검토 기준 조항">
                        {/* 검토 기준 조항의 항목 제목 표시 */}
                        <h3>검토 기준 조항</h3>
                        {/* 규정 인용 목록 표시 */}
                        <Citations citations={filter.ruleReferences} />
                    </section>
                ) : null}
                {/* 필터 버전 ·의 보조 문구 표시 */}
                <small>필터 버전 · {filter.filterVersion}</small>
            </section>
        );
    }
    // 선택 장면 판정 조회
    const judgment = candidate.judgment;
    // 저장된 과거 판정이 없는 후보인지 확인
    if (!judgment) {
        // 과거 판정 데이터가 없는 후보는 현재 파이프라인의 근거 부족 상태로 표시
        return (
            <section className="rule-panel pending" aria-label="규정 대조">
                {/* 규정 대조의 화면 묶음 표시 */}
                <div>
                    {/* 규정 대조의 안내 문구 표시 */}
                    <p>규정 대조</p>
                    {/* 규정 판단 근거 부족의 구역 제목 표시 */}
                    <h2>규정 판단 근거 부족</h2>
                </div>
                {/* 규정 대조의 안내 문구 표시 */}
                <p>현재 파이프라인의 화면 변화 정보만으로는 접촉과 강도를 확인할 수 없습니다</p>
            </section>
        );
    }

    // 국제축구평의회 인용 분리
    const ifab = judgment.citations.filter((citation) => citation.authority === "IFAB");
    // 케이리그 인용 분리
    const kleague = judgment.citations.filter((citation) => citation.authority === "KLEAGUE");
    // 사실 묶음 선택
    const facts = judgment.facts.push;
    // 관측 판정 묶음 선택
    const observed = judgment.facts.observed;

    // 현재 상태에 맞는 규정 평가와 인용 화면 반환
    return (
        <div className="rule-panel">
            {/* 선택 장면 규정 평가 제목의 제목 영역 표시 */}
            <header className="rule-heading">
                {/* 규정 대조의 화면 묶음 표시 */}
                <div>
                    {/* 선택 장면 규정 대조의 안내 문구 표시 */}
                    <p>선택 장면 규정 대조</p>
                    {/* 규정 대조의 구역 제목 표시 */}
                    <h2>{decision(judgment.decision)}</h2>
                </div>
                {/* 규정 대조의 짧은 문구 표시 */}
                <span>
                    {analysis.rule
                        ? `${analysis.rule.competition} ${analysis.rule.season} · IFAB ${analysis.rule.ifabEdition}`
                        : "규정 판본 미확인"}
                </span>
            </header>
            {/* 확인 사실과 관측 판정 및 인용의 화면 묶음 표시 */}
            <div className="rule-grid">
                {/* 영상에서 확인된 사실 표시 */}
                <section aria-label="확인된 사실">
                    {/* 확인된 사실의 항목 제목 표시 */}
                    <h3>확인된 사실</h3>
                    {/* 확인 사실과 판정 항목의 항목 설명 목록 표시 */}
                    <dl className="fact-grid">
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 접촉의 항목 이름 표시 */}
                            <dt>접촉</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>
                                {facts.contactDetected.value === null
                                    ? "미확인"
                                    : facts.contactDetected.value
                                      ? "확인"
                                      : "없음"}
                            </dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 강도의 항목 이름 표시 */}
                            <dt>강도</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[facts.severity.value]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 밀림의 항목 이름 표시 */}
                            <dt>밀림</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[facts.opponentDisplacement.value]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 관측 속도의 항목 이름 표시 */}
                            <dt>관측 속도</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[facts.severity.observedAtSpeed]}</dd>
                        </div>
                    </dl>
                    {/* 규정 대조 보충 안내의 안내 문구 표시 */}
                    <p className="rule-empty">
                        사실 출처 ·{" "}
                        {judgment.source === "USER"
                            ? "사용자 확인"
                            : judgment.source === "MODEL"
                              ? "영상 모델"
                              : "검수자 확인"}
                    </p>
                    {judgment.inconclusiveReason ? (
                        // 규정 대조 보충 안내의 안내 문구 표시
                        <p className="rule-empty">{labels[judgment.inconclusiveReason]}</p>
                    ) : null}
                </section>
                {/* 관측된 원심과 규정 결과 비교 */}
                <section aria-label="관측 판정 비교">
                    {/* 관측 판정 비교의 항목 제목 표시 */}
                    <h3>관측 판정 비교</h3>
                    {/* 확인 사실과 판정 항목의 항목 설명 목록 표시 */}
                    <dl className="fact-grid">
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 경기 재개의 항목 이름 표시 */}
                            <dt>경기 재개</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[observed.restartType]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 재개 대상의 항목 이름 표시 */}
                            <dt>재개 대상</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[observed.restartBeneficiary]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 카드의 항목 이름 표시 */}
                            <dt>카드</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{observed.card === null ? "미확인" : labels[observed.card]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 득점 판정의 항목 이름 표시 */}
                            <dt>득점 판정</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[observed.goalDecision]}</dd>
                        </div>
                    </dl>
                    {/* 재개와 카드 비교 ·의 안내 문구 표시 */}
                    <p className={`rule-match ${judgment.decisionMatch.toLowerCase()}`}>
                        재개와 카드 비교 · {labels[judgment.decisionMatch]}
                    </p>
                    {/* 규정 대조 보충 안내의 안내 문구 표시 */}
                    <p className="rule-empty">관측 출처 · {labels[observed.source]}</p>
                </section>
                {/* 국제축구평의회 규정 인용 표시 */}
                <section aria-label="IFAB 규정">
                    {/* 국제축구평의회 규정의 항목 제목 표시 */}
                    <h3>IFAB 규정</h3>
                    {/* 규정 인용 목록 표시 */}
                    <Citations citations={ifab} />
                </section>
                {/* 케이리그 대회요강 인용 표시 */}
                <section aria-label="K리그 대회요강">
                    {/* 케이리그 대회요강의 항목 제목 표시 */}
                    <h3>K리그 대회요강</h3>
                    {/* 규정 인용 목록 표시 */}
                    <Citations citations={kleague} />
                </section>
                {/* 비디오 판독 검토의 내용 구역 표시 */}
                <section className="var-panel" aria-label="VAR 검토">
                    {/* 비디오 판독 검토의 항목 제목 표시 */}
                    <h3>VAR 검토</h3>
                    {/* 비디오 판독 검토 조건의 항목 설명 목록 표시 */}
                    <dl className="var-grid">
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 검토 범위의 항목 이름 표시 */}
                            <dt>검토 범위</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{judgment.varAssessment.reviewable ? "해당" : "해당 없음"}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 재개 시한의 항목 이름 표시 */}
                            <dt>재개 시한</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>
                                {judgment.varAssessment.withinTimeWindow ? "검토 가능" : "종료"}
                            </dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 명백한 오류 문턱의 항목 이름 표시 */}
                            <dt>명백한 오류 문턱</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[judgment.varAssessment.thresholdMet]}</dd>
                        </div>
                        {/* 규정 대조의 화면 묶음 표시 */}
                        <div>
                            {/* 절차의 항목 이름 표시 */}
                            <dt>절차</dt>
                            {/* 규정 대조의 항목 설명 표시 */}
                            <dd>{labels[judgment.varAssessment.reviewProcedure]}</dd>
                        </div>
                    </dl>
                    {/* 규정 대조의 안내 문구 표시 */}
                    <p>{judgment.varAssessment.explanation}</p>
                </section>
            </div>
        </div>
    );
}
