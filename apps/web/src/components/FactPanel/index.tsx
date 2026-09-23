"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { CandidateView } from "@replay/application";
import { reviewFacts, reviewFields, reviewValues } from "../../constant/review";

// 현재 결과 화면에는 연결하지 않는 과거 수동 검토 경로
// 기존 이력과 테스트 호환을 위해 파일을 보존

// 응답 오류를 사용자 작업 안내로 변환
const explanation = (kind: string): string => ({
    // 세션 접근 권한 만료 상태의 안내 문구 연결
    UNAUTHORIZED: "세션이 만료되어 새 영상 분석이 필요합니다",
    // 다른 화면의 사실 이력 변경 상태의 안내 문구 연결
    STALE_FACT_REVISION: "다른 화면에서 사실이 변경되었습니다 최신 결과를 불러온 뒤 다시 확인하세요",
    // 분석 상태 변경 상태의 안내 문구 연결
    STALE_ANALYSIS: "분석 상태가 변경되었습니다 최신 결과를 불러온 뒤 다시 확인하세요",
    // 적용 규정 판본 미확인 상태의 안내 문구 연결
    RULE_VERSION_UNKNOWN: "적용 규정 판본을 확인할 수 없어 대조가 보류되었습니다",
    // 적용 규정 판본 사용 불가 상태의 안내 문구 연결
    RULE_VERSION_UNAVAILABLE: "적용 규정 판본을 확인할 수 없어 대조가 보류되었습니다",
    // 분석 또는 증거 접근 불가 상태의 안내 문구 연결
    NOT_FOUND: "분석이나 영상 근거의 보존 기간이 끝났거나 접근할 수 없습니다",
    // 입력 사실과 근거 샷 오류 상태의 안내 문구 연결
    INVALID_INPUT: "사실값과 근거 샷을 다시 확인하세요",
}[kind] ?? "요청을 완료하지 못했습니다 저장된 사실은 유지되며 다시 시도할 수 있습니다");

// 한 장면의 사실 보정과 서버 규정 대조
export function FactPanel({
    analysisId,
    candidate,
    onReview
}: Readonly<{
    // 분석 식별자 형식 정의
    analysisId: string;
    // 선택 후보 형식 정의
    candidate: CandidateView;
    // 서버 결과 다시 읽기 함수 형식 정의
    onReview: () => Promise<void>;
}>) {
    // 저장된 최신 사실은 판정 실패 후에도 복원
    const previous = candidate.facts ?? candidate.judgment?.facts;
    // 사용자가 직접 확인한 값 관리
    const [values, valuesState] = useState(() => reviewValues(previous));
    // 근거 샷은 자동 확정하지 않고 선택 필요
    const [shots, shotsState] = useState<string[]>(
        () => previous?.push.contactDetected.shotIds ?? []
    );
    // 저장된 사실에서 달라진 입력 추적
    const [dirty, dirt] = useState(false);
    // 검토 유형 명시적 확인
    const [confirmed, confirmation] = useState(false);
    // 처리 상태와 오류 안내
    const [busy, activity] = useState(false);
    // 사실 저장과 규정 대조 안내 상태 생성
    const [notice, notification] = useState("");
    // 빠른 이중 제출과 화면 종료 뒤 갱신 차단
    const pending = useRef(false);
    // 화면 종료 후 상태 갱신을 막을 참조 생성
    const alive = useRef(true);
    // 같은 사실 재시도에는 같은 멱등 키 유지
    const submission = useRef<{ fingerprint: string; key: string; expected: string | null } | null>(
        null
    );
    // 서버가 승인한 최신 이력 추적
    const revision = useRef(candidate.factRevisionId ?? candidate.judgment?.factRevisionId ?? null);
    // 화면 종료 시 후속 요청과 화면 갱신 중단
    useEffect(() => {
        // 화면이 활성 상태임을 기록
        alive.current = true;
        // 화면 종료 시 실행할 자원 정리 함수 반환
        return () => {
            // 화면 종료 후 비동기 응답의 상태 갱신 차단
            alive.current = false;
        };
    }, []);

    // 사실 저장 후 같은 후보의 규정 대조 수행
    const review = async (event: React.FormEvent<HTMLFormElement>) => {
        // 브라우저 기본 제출 차단
        event.preventDefault();
        // 중복 요청 방지
        if (pending.current) return;
        // 필수 확인과 선택값 검증
        const facts = reviewFacts(values, shots);
        // 검토 유형 확인이나 유효한 사실이 빠졌는지 확인
        if (!confirmed || !facts) {
            // 필수 검토 조건의 누락 안내 표시
            notification("밀기 검토 유형과 근거 샷 및 모든 사실 조건을 확인하세요");
            // 필수 사실이 부족한 제출 중단
            return;
        }
        // 제출 시점의 입력 고정
        const fingerprint = JSON.stringify(facts);
        // 사실 내용이 바뀌어 새 제출 키가 필요한지 확인
        if (submission.current?.fingerprint !== fingerprint) {
            // 사실 내용과 새 멱등 키 및 비교할 이력을 함께 보관
            submission.current = {
                // 제출 사실 내용 서명 연결
                fingerprint,
                // 중복 요청 구분 키 연결
                key: crypto.randomUUID(),
                // 서버 사실 이력 비교 기준 연결
                expected: revision.current
            };
        }
        // 요청 상태 전환
        pending.current = true;
        // 사실 제출 중 입력 잠금 활성화
        activity(true);
        // 사실 저장 진행 안내 표시
        notification("확인한 사실 저장 중");
        // 세션 권한은 서버에서 다시 확인
        const base = `/api/analyses/${analysisId}/candidates/${candidate.id}`;
        try {
            // 버전과 멱등 키를 포함한 사실 저장
            // 변경 없는 사실은 기존 이력으로 규정 대조만 재시도
            if (!revision.current || dirty) {
                // 사실과 기존 이력을 서버에 저장한 응답 읽음
                const response = await fetch(`${base}/facts`, {
                    // 서버 요청 방식 연결
                    method: "PATCH",
                    // 요청 본문의 형식 안내 연결
                    headers: { "content-type": "application/json" },
                    // 서버에 전달할 요청 본문 연결
                    body: JSON.stringify({
                        // 규정 평가에 사용할 사실 연결
                        facts,
                        // 같은 제출을 구분할 멱등 키 연결
                        idempotencyKey: submission.current.key,
                        // 동시 변경을 확인할 사실 이력 연결
                        expectedFactRevisionId: submission.current.expected
                    })
                });
                // 저장 응답 형식 확인
                const saved = await response.json();
                // 서버 응답이 성공 조건과 기대 형식을 충족하는지 확인
                if (
                    !response.ok ||
                    !["CREATED", "REPLAYED"].includes(saved.kind) ||
                    typeof saved.factRevisionId !== "string"
                )
                    // 서버 응답의 실패를 오류 경로로 전달
                    throw new Error(saved.kind);
                // 평가 실패 시에도 새 이력 유지
                revision.current = saved.factRevisionId;
            }
            // 이동한 화면에서 불필요한 규정 요청 방지
            if (!alive.current) return;
            // 규정 대조 진행 안내 표시
            notification("IFAB와 K리그 규정 대조 중");
            // 서버 규정 엔진 요청
            const evaluated = await fetch(`${base}/evaluate`, { method: "POST" });
            // 규정 평가 응답 본문 읽음
            const result = await evaluated.json();
            // 규정 평가 응답이 신규 생성이나 재시도 성공인지 확인
            if (!evaluated.ok || !["CREATED", "REPLAYED"].includes(result.kind))
                // 서버 응답의 실패를 오류 경로로 전달
                throw new Error(result.kind);
            // 서버의 최신 판정과 인용 반영
            await onReview();
            // 화면이 남아 있을 때만 후속 상태 갱신 허용
            if (alive.current) notification("규정 대조 완료 아래에서 근거 조항과 VAR 검토 확인");
        } catch (error) {
            // 최신 사실과 판정 상태를 다시 조회해 오래된 판정 제거
            await onReview().catch(() => undefined);
            // 화면이 남아 있을 때만 후속 상태 갱신 허용
            if (alive.current)
                // 서버 오류를 다시 시도할 수 있는 안내 문구로 변환
                notification(explanation(error instanceof Error ? error.message : ""));
        } finally {
            // 다음 명시적 제출 허용
            pending.current = false;
            // 화면이 남아 있을 때만 후속 상태 갱신 허용
            if (alive.current) activity(false);
        }
    };

    // 장면별 사실 확인 영역
    return (
        <section className="fact-panel" aria-label="장면 사실 확인">
            {/* 사실 확인의 제목 영역 표시 */}
            <header>
                {/* 영상 사실 확인의 안내 문구 표시 */}
                <p>영상 사실 확인</p>
                {/* 장면 확인 후 규정 대조의 구역 제목 표시 */}
                <h2>장면 확인 후 규정 대조</h2>
                {/* 사실 확인의 안내 문구 표시 */}
                <p>
                    첫 검토 유형은 밀기 장면입니다 화면에서 확인한 조건으로 IFAB와 K리그 조항을
                    대조합니다
                </p>
            </header>
            {/* 모델 출력은 수정 가능한 관찰 후보로만 표시 */}
            {candidate.observation ? (
                // 과거 관찰 기록의 보조 정보 표시
                <aside className="fact-observation">
                    {/* 과거 관찰 기록 · 현재 자동 경로 미사용의 강조 문구 표시 */}
                    <strong>과거 관찰 기록 · 현재 자동 경로 미사용</strong>
                    {/* 사실 확인의 안내 문구 표시 */}
                    <p>{candidate.observation.summary}</p>
                    {/* 기록 프레임의 보조 문구 표시 */}
                    <small>
                        기록 프레임{" "}
                        {candidate.observation.timestamps
                            .map((time) => `${(time / 1000).toFixed(1)}초`)
                            .join(" · ")}
                    </small>
                </aside>
            ) : (
                // 사실 확인 한계 안내의 안내 문구 표시
                <p className="fact-hint">
                    이 장면의 자동 관찰은 준비되지 않았습니다 영상을 직접 확인해 사실을 입력할 수
                    있습니다
                </p>
            )}
            {/* 사실 확인의 사실 제출 양식 표시 */}
            <form onSubmit={review}>
                {/* 처리 중인 사실 변경 방지 */}
                <fieldset disabled={busy}>
                    {/* 검토 대상과 영상 근거의 입력 묶음 제목 표시 */}
                    <legend>검토 대상과 영상 근거</legend>
                    {/* 검토 유형과 근거 샷 확인의 입력 설명 표시 */}
                    <label className="fact-check">
                        {/* 사실 확인의 입력 요소 표시 */}
                        <input
                            type="checkbox"
                            // 저장된 선택 상태를 확인란에 반영
                            checked={confirmed}
                            // 입력 변경 시 선택 상태 반영
                            onChange={(event) => confirmation(event.target.checked)}
                        />
                        밀기 유형으로 검토할 장면임을 확인
                    </label>
                    {/* 사실 확인의 안내 문구 표시 */}
                    <p>확인한 샷 선택 · 플레이어의 배속 설정과 중계 원본 속도는 별도</p>
                    {/* 실제 분석 샷 식별자만 선택 가능 */}
                    {(candidate.shots ?? []).map((shot) => (
                        // 검토 유형과 근거 샷 확인의 입력 설명 표시
                        <label className="fact-check" key={shot.id}>
                            {/* 사실 확인의 입력 요소 표시 */}
                            <input
                                type="checkbox"
                                // 저장된 선택 상태를 확인란에 반영
                                checked={shots.includes(shot.id)}
                                // 입력 변경 시 선택 상태 반영
                                onChange={(event) => {
                                    // 선택 사실이 저장 이력과 달라졌음을 기록
                                    dirt(true);
                                    // 확인란 선택에 따라 근거 샷 식별자를 추가하거나 제거
                                    shotsState((current) =>
                                        event.target.checked
                                            ? [...current, shot.id]
                                            : current.filter((id) => id !== shot.id)
                                    );
                                }}
                            />
                            샷 {shot.index + 1} · {(shot.startMs / 1000).toFixed(1)}초 ~{" "}
                            {(shot.endMs / 1000).toFixed(1)}초
                        </label>
                    ))}
                    {candidate.shots?.length ? null : (
                        // 근거 샷 부재로 규정 대조가 불가능한 상태 안내 표시
                        <p>연결된 샷이 없어 대조할 수 없습니다 영상을 다시 분석하세요</p>
                    )}
                </fieldset>
                {/* 불확실한 항목을 거짓이나 파울 없음으로 자동 변환하지 않음 */}
                {["영상 사실", "VAR 조건", "관측 판정"].map((group) => (
                    // 사실 확인의 관련 입력 묶음 표시
                    <fieldset key={group} disabled={busy}>
                        {/* 사실 확인의 입력 묶음 제목 표시 */}
                        <legend>{group}</legend>
                        {/* 사실 항목별 선택의 화면 묶음 표시 */}
                        <div className="fact-fields">
                            {reviewFields
                                .filter((field) => field.group === group)
                                .map((field) => (
                                    // 사실 확인의 입력 설명 표시
                                    <label key={field.name}>
                                        {field.label}
                                        {/* 사실 확인의 선택 목록 표시 */}
                                        <select
                                            // 보조 기술이 읽을 화면 요소 이름 지정
                                            aria-label={field.label}
                                            // 현재 입력이나 진행 상태를 화면 값에 반영
                                            value={values[field.name] ?? ""}
                                            // 입력 변경 시 선택 상태 반영
                                            onChange={(event) => {
                                                // 선택 사실이 저장 이력과 달라졌음을 기록
                                                dirt(true);
                                                // 기존 사실 선택을 보존하면서 변경 항목의 상태 갱신
                                                valuesState((current) => ({
                                                    ...current,
                                                    // 변경한 사실 항목만 새 선택값으로 교체
                                                    [field.name]: event.target.value
                                                }));
                                            }}
                                        >
                                            {/* 확인 후 선택의 선택 항목 표시 */}
                                            <option value="">확인 후 선택</option>
                                            {field.options.map(([key, label]) => (
                                                // 사실 확인의 선택 항목 표시
                                                <option key={key} value={key}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                        </div>
                    </fieldset>
                ))}
                {/* 결과는 서버 저장이 확인된 뒤 갱신 */}
                <div className="fact-actions">
                    {/* 사실 확인의 동작 버튼 표시 */}
                    <button
                        type="submit"
                        // 진행 상태와 선택 조건에 따라 입력 잠금
                        disabled={busy || !confirmed || !reviewFacts(values, shots)}
                    >
                        {busy ? "규정 대조 중" : "사실 확인 후 규정 대조"}
                    </button>
                    {/* 최신 결과 불러오기의 동작 버튼 표시 */}
                    <button
                        type="button"
                        // 진행 상태와 선택 조건에 따라 입력 잠금
                        disabled={busy}
                        // 클릭 시 연결된 화면 동작 실행
                        onClick={() => {
                            // 최신 결과를 다시 읽고 실패하면 안내 문구 표시
                            void onReview().catch(() =>
                                notification("최신 결과를 불러오지 못했습니다")
                            );
                        }}
                    >
                        최신 결과 불러오기
                    </button>
                </div>
                {/* 사실 확인의 안내 문구 표시 */}
                <p role="status" aria-live="polite">
                    {notice || "확인되지 않은 조건은 추정하지 않고 대조 보류"}
                </p>
            </form>
        </section>
    );
}
