"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { CandidateView } from "@replay/application";
import { reviewFacts, reviewFields, reviewValues } from "../../constant/review";

// 현재 결과 화면에는 연결하지 않는 과거 수동 검토 경로
// 기존 이력과 테스트 호환을 위해 파일을 보존한다

// 응답 오류를 사용자 작업 안내로 변환
const explanation = (kind: string): string => ({
  UNAUTHORIZED: "세션이 만료되어 새 영상 분석이 필요합니다",
  STALE_FACT_REVISION: "다른 화면에서 사실이 변경되었습니다 최신 결과를 불러온 뒤 다시 확인하세요",
  STALE_ANALYSIS: "분석 상태가 변경되었습니다 최신 결과를 불러온 뒤 다시 확인하세요",
  RULE_VERSION_UNKNOWN: "적용 규정 판본을 확인할 수 없어 대조가 보류되었습니다",
  RULE_VERSION_UNAVAILABLE: "적용 규정 판본을 확인할 수 없어 대조가 보류되었습니다",
  NOT_FOUND: "분석이나 영상 근거의 보존 기간이 끝났거나 접근할 수 없습니다",
  INVALID_INPUT: "사실값과 근거 샷을 다시 확인하세요",
}[kind] ?? "요청을 완료하지 못했습니다 저장된 사실은 유지되며 다시 시도할 수 있습니다");

// 한 장면의 사실 보정과 서버 규정 대조
export function FactPanel({ analysisId, candidate, onReview }: Readonly<{
  analysisId: string; candidate: CandidateView; onReview: () => Promise<void>;
}>) {
  // 저장된 최신 사실은 판정 실패 후에도 복원
  const previous = candidate.facts ?? candidate.judgment?.facts;
  // 사용자가 직접 확인한 값 관리
  const [values, valuesState] = useState(() => reviewValues(previous));
  // 근거 샷은 자동 확정하지 않고 선택 필요
  const [shots, shotsState] = useState<string[]>(() => previous?.push.contactDetected.shotIds ?? []);
  // 저장된 사실에서 달라진 입력 추적
  const [dirty, dirt] = useState(false);
  // 검토 유형 명시적 확인
  const [confirmed, confirmation] = useState(false);
  // 처리 상태와 오류 안내
  const [busy, activity] = useState(false);
  const [notice, notification] = useState("");
  // 빠른 이중 제출과 화면 종료 뒤 갱신 차단
  const pending = useRef(false);
  const alive = useRef(true);
  // 같은 사실 재시도에는 같은 멱등 키 유지
  const submission = useRef<{ fingerprint: string; key: string; expected: string | null } | null>(null);
  // 서버가 승인한 최신 이력 추적
  const revision = useRef(candidate.factRevisionId ?? candidate.judgment?.factRevisionId ?? null);
  // 화면 종료 시 후속 요청과 화면 갱신 중단
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // 사실 저장 후 같은 후보의 규정 대조 수행
  const review = async (event: React.FormEvent<HTMLFormElement>) => {
    // 브라우저 기본 제출 차단
    event.preventDefault();
    // 중복 요청 방지
    if (pending.current) return;
    // 필수 확인과 선택값 검증
    const facts = reviewFacts(values, shots);
    if (!confirmed || !facts) { notification("밀기 검토 유형과 근거 샷 및 모든 사실 조건을 확인하세요"); return; }
    // 제출 시점의 입력 고정
    const fingerprint = JSON.stringify(facts);
    if (submission.current?.fingerprint !== fingerprint) {
      submission.current = { fingerprint, key: crypto.randomUUID(), expected: revision.current };
    }
    // 요청 상태 전환
    pending.current = true;
    activity(true);
    notification("확인한 사실 저장 중");
    // 세션 권한은 서버에서 다시 확인
    const base = `/api/analyses/${analysisId}/candidates/${candidate.id}`;
    try {
      // 버전과 멱등 키를 포함한 사실 저장
      // 변경 없는 사실은 기존 이력으로 규정 대조만 재시도
      if (!revision.current || dirty) {
        const response = await fetch(`${base}/facts`, { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ facts, idempotencyKey: submission.current.key, expectedFactRevisionId: submission.current.expected }) });
        // 저장 응답 형식 확인
        const saved = await response.json();
        if (!response.ok || !["CREATED", "REPLAYED"].includes(saved.kind) || typeof saved.factRevisionId !== "string") throw new Error(saved.kind);
        // 평가 실패 시에도 새 이력 유지
        revision.current = saved.factRevisionId;
      }
      // 이동한 화면에서 불필요한 규정 요청 방지
      if (!alive.current) return;
      notification("IFAB와 K리그 규정 대조 중");
      // 서버 규정 엔진 요청
      const evaluated = await fetch(`${base}/evaluate`, { method: "POST" });
      const result = await evaluated.json();
      if (!evaluated.ok || !["CREATED", "REPLAYED"].includes(result.kind)) throw new Error(result.kind);
      // 서버의 최신 판정과 인용 반영
      await onReview();
      if (alive.current) notification("규정 대조 완료 아래에서 근거 조항과 VAR 검토 확인");
    } catch (error) {
      // 최신 사실과 판정 상태를 다시 조회해 오래된 판정 제거
      await onReview().catch(() => undefined);
      if (alive.current) notification(explanation(error instanceof Error ? error.message : ""));
    } finally {
      // 다음 명시적 제출 허용
      pending.current = false;
      if (alive.current) activity(false);
    }
  };

  // 장면별 사실 확인 영역
  return <section className="fact-panel" aria-label="장면 사실 확인">
    <header><p>영상 사실 확인</p><h2>장면 확인 후 규정 대조</h2><p>첫 검토 유형은 밀기 장면입니다 화면에서 확인한 조건으로 IFAB와 K리그 조항을 대조합니다</p></header>
    {/* 모델 출력은 수정 가능한 관찰 후보로만 표시 */}
    {candidate.observation ? <aside className="fact-observation"><strong>과거 관찰 기록 · 현재 자동 경로 미사용</strong><p>{candidate.observation.summary}</p><small>기록 프레임 {candidate.observation.timestamps.map((time) => `${(time / 1000).toFixed(1)}초`).join(" · ")}</small></aside>
      : <p className="fact-hint">이 장면의 자동 관찰은 준비되지 않았습니다 영상을 직접 확인해 사실을 입력할 수 있습니다</p>}
    <form onSubmit={review}>
      {/* 처리 중인 사실 변경 방지 */}
      <fieldset disabled={busy}>
        <legend>검토 대상과 영상 근거</legend>
        <label className="fact-check"><input type="checkbox" checked={confirmed} onChange={(event) => confirmation(event.target.checked)} />밀기 유형으로 검토할 장면임을 확인</label>
        <p>확인한 샷 선택 · 플레이어의 배속 설정과 중계 원본 속도는 별도</p>
        {/* 실제 분석 샷 식별자만 선택 가능 */}
        {(candidate.shots ?? []).map((shot) => <label className="fact-check" key={shot.id}><input type="checkbox" checked={shots.includes(shot.id)} onChange={(event) => { dirt(true); shotsState((current) => event.target.checked ? [...current, shot.id] : current.filter((id) => id !== shot.id)); }} />샷 {shot.index + 1} · {(shot.startMs / 1000).toFixed(1)}초 ~ {(shot.endMs / 1000).toFixed(1)}초</label>)}
        {candidate.shots?.length ? null : <p>연결된 샷이 없어 대조할 수 없습니다 영상을 다시 분석하세요</p>}
      </fieldset>
      {/* 불확실한 항목을 거짓이나 파울 없음으로 자동 변환하지 않음 */}
      {["영상 사실", "VAR 조건", "관측 판정"].map((group) => <fieldset key={group} disabled={busy}><legend>{group}</legend><div className="fact-fields">
        {reviewFields.filter((field) => field.group === group).map((field) => <label key={field.name}>{field.label}<select aria-label={field.label} value={values[field.name] ?? ""} onChange={(event) => { dirt(true); valuesState((current) => ({ ...current, [field.name]: event.target.value })); }}>
          <option value="">확인 후 선택</option>{field.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>)}
      </div></fieldset>)}
      {/* 결과는 서버 저장이 확인된 뒤 갱신 */}
      <div className="fact-actions"><button type="submit" disabled={busy || !confirmed || !reviewFacts(values, shots)}>{busy ? "규정 대조 중" : "사실 확인 후 규정 대조"}</button><button type="button" disabled={busy} onClick={() => { void onReview().catch(() => notification("최신 결과를 불러오지 못했습니다")); }}>최신 결과 불러오기</button></div>
      <p role="status" aria-live="polite">{notice || "확인되지 않은 조건은 추정하지 않고 대조 보류"}</p>
    </form>
  </section>;
}
