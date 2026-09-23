// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import { memo, useEffect, useRef } from "react";
import * as React from "react";
import type { CandidateView } from "@replay/application";

// 후보 목록과 선택 위치 및 선택 알림의 입력 형식 정의
type SceneListProps = Readonly<{
    // 분석 식별자 형식 정의
    analysisId: string;
    // 공개 후보 목록 형식 정의
    candidates: readonly CandidateView[];
    // 현재 선택 상태 형식 정의
    active: number;
    // 후보 선택 알림 함수 형식 정의
    onSelect: (index: number) => void;
}>;

// 후보 한 행의 표시 자료와 선택 알림 형식 정의
type SceneRowProps = Readonly<{
    // 분석 식별자 형식 정의
    analysisId: string;
    // 선택 후보 형식 정의
    candidate: CandidateView;
    // 목록 위치 형식 정의
    index: number;
    // 현재 선택 상태 형식 정의
    active: boolean;
    // 후보 선택 알림 함수 형식 정의
    onSelect: (index: number) => void;
}>;

// 밀리초를 시간 문구로 변환
const time = (value: number): string => {
    // 음수 시간을 0초로 보정
    const seconds = Math.max(0, Math.floor(value / 1000));
    // 분과 초 형식 생성
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

// 같은 입력의 후보 행을 다시 그리지 않도록 화면 함수 감쌈
const SceneRow = memo(function SceneRow({
    analysisId,
    candidate,
    index,
    active,
    onSelect
}: SceneRowProps) {
    // 활성 행 참조
    const row = useRef<HTMLLIElement>(null);
    // 대표 프레임 선택
    const frame = candidate.evidence?.find((item) => item.kind === "FRAME");
    // 선택 후보의 비디오 판독 범위 평가 읽음
    const scope = candidate.varScopeEvaluation;
    // 자동 규정 평가 완료 여부 확인
    const automaticCompleted = candidate.automaticJudgment?.status === "COMPLETED";
    // 대회 비디오 판독 범위 평가 완료 여부 확인
    const scopeCompleted = scope?.kind === "COMPETITION_VAR_SCOPE" && scope.status === "COMPLETED";
    // 코너킥 사건의 관측 완료 여부 확인
    const cornerObserved =
        candidate.sceneEvent?.kind === "CORNER_KICK" && candidate.sceneEvent.status === "OBSERVED";
    // 관측된 코너킥의 영상 근거 부족 여부 확인
    const cornerEvidenceUnavailable =
        !scopeCompleted &&
        cornerObserved &&
        candidate.filter?.status === "UNDETERMINED" &&
        candidate.filter.reasonCodes.includes("EVIDENCE_UNAVAILABLE");
    // 완료된 평가와 관측 사건에 맞는 장면 이름 선택
    const sceneLabel = automaticCompleted
        ? "밀기 평가 장면"
        : scopeCompleted && scope.topic === "GOAL_RELATED"
          ? "득점 관련 장면"
          : cornerObserved
            ? "코너킥 장면"
            : "후보 장면";
    // 규정 평가와 범위 평가 및 근거 부족 상태를 구분한 문구 선택
    const filterLabel = automaticCompleted
        ? "밀기 규정 평가 완료"
        : scopeCompleted
          ? "범위 평가 완료"
          : candidate.filter
            ? {
                  // 표시 대상 제외 의미의 내부 코드를 화면 문구에 연결
                  EXCLUDED: "표시 대상 제외",
                  // 영상 근거 부재와 그 외 규정 판단 근거 부족의 안내 구분
                  UNDETERMINED: cornerEvidenceUnavailable
                      ? "영상 근거 제공 불가"
                      : "규정 판단 근거 부족",
                  // 재개 장면 관찰 · 참고 규정 의미의 내부 코드를 화면 문구에 연결
                  OBSERVED: "재개 장면 관찰 · 참고 규정",
                  // 검토할 규정 연결 의미의 내부 코드를 화면 문구에 연결
                  APPLICABLE: "검토할 규정 연결"
              }[candidate.filter.status]
            : "파이프라인 후보";

    // 선택 상태가 바뀌면 활성 행을 보이도록 화면 효과 연결
    useEffect(() => {
        // 활성 후보를 목록 안에서 보이도록 이동
        if (active && typeof row.current?.scrollIntoView === "function") {
            // 선택 행이 보이도록 가장 가까운 위치까지 목록 이동
            row.current.scrollIntoView({ block: "nearest" });
        }
    }, [active]);

    // 현재 상태에 맞는 후보 장면 한 행 화면 반환
    return (
        <li ref={row}>
            {/* 후보 장면의 동작 버튼 표시 */}
            <button
                type="button"
                // 현재 선택된 후보임을 보조 기술에 전달
                aria-current={active ? "true" : undefined}
                // 보조 기술이 읽을 화면 요소 이름 지정
                aria-label={`${sceneLabel} ${String(index + 1).padStart(2, "0")} ${time(candidate.startMs)}부터 ${time(candidate.endMs)}`}
                // 클릭 시 연결된 화면 동작 실행
                onClick={() => onSelect(index)}
            >
                {/* 후보 대표 프레임 표시 */}
                <span className="rail-thumb">
                    {frame ? (
                        // 후보 장면의 이미지 표시
                        <img
                            // 표시할 영상이나 이미지 주소 연결
                            src={`/api/analyses/${analysisId}/evidence/${frame.evidenceId}`}
                            // 이미지를 볼 수 없을 때 사용할 설명 연결
                            alt=""
                            // 화면 접근 시 필요한 이미지를 늦게 읽도록 지정
                            loading="lazy"
                            // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                            decoding="async"
                        />
                    ) : (
                        // 후보 장면의 짧은 문구 표시
                        <span>
                            {cornerEvidenceUnavailable ? "영상 근거 없음" : "프레임 준비 중"}
                        </span>
                    )}
                </span>
                {/* 후보 시간과 판정 상태 표시 */}
                <span className="rail-copy">
                    {/* 후보 장면의 강조 문구 표시 */}
                    <strong>
                        {sceneLabel} {String(index + 1).padStart(2, "0")}
                    </strong>
                    {/* 부터의 보조 문구 표시 */}
                    <small>
                        {time(candidate.startMs)}부터 {time(candidate.endMs)}
                    </small>
                    {/* 후보 장면의 상태 강조 문구 표시 */}
                    <em>{filterLabel}</em>
                </span>
                {/* 완료 범위 평가와 재개 장면은 변화 신호 점수로 표시하지 않는다 */}
                {automaticCompleted ? (
                    // 장면의 평가 종류 또는 변화 점수의 짧은 문구 표시
                    <span className="rail-score">규정 평가</span>
                ) : scopeCompleted ? (
                    // 장면의 평가 종류 또는 변화 점수의 짧은 문구 표시
                    <span className="rail-score">범위 평가</span>
                ) : cornerObserved ? (
                    // 장면의 평가 종류 또는 변화 점수의 짧은 문구 표시
                    <span className="rail-score">재개</span>
                ) : (
                    // 장면의 평가 종류 또는 변화 점수의 짧은 문구 표시
                    <span className="rail-score" aria-label="화면 변화 점수이며 파울 확률이 아님">
                        {candidate.signalScore === null
                            ? "—"
                            : `${Math.round(candidate.signalScore * 100)}%`}
                    </span>
                )}
            </button>
        </li>
    );
});

// 화면 요소 구성
export function SceneList({ analysisId, candidates, active, onSelect }: SceneListProps) {
    // 후보 장면 목록 표시
    return (
        <aside className="rail-panel" aria-label="전체 후보 장면">
            {/* 후보 장면의 제목 영역 표시 */}
            <header>
                {/* 주요 장면의 강조 문구 표시 */}
                <strong>주요 장면</strong>
                {/* 건의 짧은 문구 표시 */}
                <span>{candidates.length}건</span>
            </header>
            {/* 선택 가능한 후보 목록의 순서 있는 목록 표시 */}
            <ol className="scene-rail">
                {candidates.map((candidate, index) => (
                    // 후보 장면 한 행 표시
                    <SceneRow
                        // 반복 화면 요소의 고유 항목 구분
                        key={candidate.id}
                        analysisId={analysisId}
                        candidate={candidate}
                        index={index}
                        active={index === active}
                        onSelect={onSelect}
                    />
                ))}
            </ol>
        </aside>
    );
}
