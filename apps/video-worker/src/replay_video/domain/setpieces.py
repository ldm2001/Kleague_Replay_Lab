# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 관측 필드 자료형 선언 도구 가져옴
from dataclasses import dataclass
# 순회 입력과 허용 문자열의 타입 표기 가져옴
from typing import Iterable, Literal


# 허용하는 재개 유형의 문자열 타입 선언
RestartKind = Literal[
    "KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"
]
# 입력 검증에 사용할 재개 유형의 불변 집합 생성
RESTART_KINDS = frozenset(
    {"KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"}
)


@dataclass(frozen=True, slots=True)
# 원본 시각에 대응하는 재개 근거 자료형 선언
class RestartObservation:
    # 원본 시각 사용과 연속 구간 변경 시 이전 관측 연결 금지
    timestamp_ms: int
    # 관측을 연결할 연속 영상 구간 번호 보관
    continuity_id: int
    # 경기 중단 사실의 확인 또는 미확인 상태 보관
    dead_ball: bool | None = None
    # 공 재개 사실의 확인 또는 미확인 상태 보관
    ball_restarted: bool | None = None
    # 근거가 제시한 재개 유형 후보 보관
    restart_candidates: tuple[RestartKind, ...] = ()
    # 관측을 뒷받침할 증거 식별자 보관
    evidence_ids: tuple[str, ...] = ()
    # 빈 값은 본방송 여부도 미확인
    is_replay: bool | None = None
    # 영상 패턴 전용 값과 규정상 인플레이 상태 분리
    preparation_detected: bool | None = None
    # 출발 영상 패턴 관측 상태 보관과 적법 재개 확정 제외
    departure_detected: bool | None = None


@dataclass(frozen=True, slots=True)
# 연결된 재개 구간의 결과 자료형 선언
class RestartEvent:
    # 준비 또는 중단 관측 시작 시각 보관
    start_ms: int
    # 사건 관측을 마감한 시각 보관
    end_ms: int
    # 근거로 관측된 재개 시각 또는 빈 값 보관
    restart_ms: int | None
    # 입력 근거의 관측 완료 또는 미확인 상태 보관
    status: Literal["OBSERVED", "UNKNOWN"]
    # 단일 재개 유형 또는 미확인 값 보관
    kind: str
    # 검토 과정에서 남은 재개 유형 후보 보관
    candidates: tuple[str, ...]
    # 구간 전체의 증거 식별자 보관
    evidence_ids: tuple[str, ...]
    # 관측 보류와 한계 사유 보관
    reasons: tuple[str, ...]

# 중단·재개 근거를 시간 순서로 결합하고 미확인 구간을 구분
def setpieces(
    observations: Iterable[RestartObservation],
    max_gap_ms: int = 1500,
    *,
    require_live_source: bool = True,
    visual_pattern: bool = False,
) -> tuple[RestartEvent, ...]:
    """근거 있는 중단·재개 순서 연결과 영상 픽셀·경기규칙 해석 제외"""
    # 최대 관측 간격의 양의 정수 여부 확인
    if type(max_gap_ms) is not int or max_gap_ms <= 0:
        # 허용할 수 없는 관측 간격 오류 전달
        raise ValueError("invalid-observation-gap")
    # 반환할 재개 사건의 빈 목록 생성
    events: list[RestartEvent] = []
    # 직전 관측의 빈 값 생성
    previous: RestartObservation | None = None
    # 진행 중인 사건의 시작 시각 초기화
    start: int | None = None
    # 재개 유형 후보의 빈 집합 생성
    possible: set[str] = set()
    # 누적 증거 식별자의 빈 집합 생성
    evidence: set[str] = set()
    # 재개 후보 충돌 여부 초기화
    conflict = False
    # 본방송 출처 확인 상태의 초기값 설정
    source_known = True

    # 연속 관측 마감과 재개 사건 목록 추가
    def episode(end: int, reason: str | None, restart: int | None = None) -> None:
        # 관찰된 순서가 완전해도 입력 후보가 충돌하면 한 종류로 확정 제외
        if start is None:
            # 열린 사건이 없으므로 마감 없이 반환
            return
        # 전달받은 마감 사유의 목록 생성
        reasons = [reason] if reason else []
        # 재개 유형 근거 부재 확인
        if not possible:
            # 재개 유형 누락 사유 추가
            reasons.append("RESTART_TYPE_MISSING")
        # 유형 충돌 또는 복수 후보 잔존 여부 확인
        if conflict or len(possible) > 1:
            # 재개 유형 모호성 사유 추가
            reasons.append("RESTART_TYPE_AMBIGUOUS")
        # 본방송 출처 미확인 여부 확인
        if not source_known:
            # 본방송 출처 미확인 사유 추가
            reasons.append("BROADCAST_SOURCE_UNKNOWN")
        # 본방송 필수 설정에 따라 완료를 막는 사유 선택
        blockers = [
            value for value in reasons if require_live_source or value != "BROADCAST_SOURCE_UNKNOWN"
        ]
        # 차단 사유 없이 재개 시각과 단일 유형이 있는지 확인
        observed = not blockers and restart is not None and len(possible) == 1
        # 관측 상태와 시각 및 정렬된 근거를 사건 목록에 추가
        events.append(
            RestartEvent(
                start,
                end,
                restart,
                "OBSERVED" if observed else "UNKNOWN",
                next(iter(possible)) if observed else "UNKNOWN",
                tuple(sorted(possible)),
                tuple(sorted(evidence)),
                tuple(reasons),
            )
        )

    # 전달된 관측을 입력 순서대로 확인
    for current in observations:
        # 정수 하위 타입인 불리언을 원본 시간 검증에서 제외
        if type(current.timestamp_ms) is not int or current.timestamp_ms < 0:
            # 유효하지 않은 원본 시각 오류 전달
            raise ValueError("invalid-observation-time")
        # 이전 시각보다 현재 시각이 증가하는지 확인
        if previous and current.timestamp_ms <= previous.timestamp_ms:
            # 중복되거나 역행한 시각 오류 전달
            raise ValueError("observation-time-not-increasing")
        # 허용 목록 밖의 재개 유형 입력 확인
        if any(value not in RESTART_KINDS for value in current.restart_candidates):
            # 지원하지 않는 재개 유형 오류 전달
            raise ValueError("invalid-restart-kind")
        # 상태값이 참 또는 거짓 또는 빈 값인지 확인
        if any(
            value is not None and type(value) is not bool
            for value in (
                current.dead_ball,
                current.ball_restarted,
                current.is_replay,
                current.preparation_detected,
                current.departure_detected,
            )
        ):
            # 상태값 타입 오류 전달
            raise ValueError("invalid-observation-state")

        # 화면 전환·긴 공백 시 열린 사건의 재개 미확인 마감
        boundary = None
        # 이전 관측과 현재 관측의 연속 구간 변경 확인
        if previous and current.continuity_id != previous.continuity_id:
            # 화면 전환 경계 사유 지정
            boundary = "SHOT_CHANGED"
        # 허용 관측 간격 초과 여부 확인
        elif previous and current.timestamp_ms - previous.timestamp_ms > max_gap_ms:
            # 관측 공백 경계 사유 지정
            boundary = "OBSERVATION_GAP"
        # 현재 관측이 리플레이인지 확인
        elif current.is_replay is True:
            # 리플레이 진입 경계 사유 지정
            boundary = "REPLAY_ENTERED"
        # 관측 연결을 끊을 경계의 존재 확인
        if boundary:
            # 경계 이전 시각으로 열린 사건 마감
            episode(previous.timestamp_ms if previous else current.timestamp_ms, boundary)
            # 새 구간을 위한 사건 시작 시각 초기화
            start = None
        # 다음 관측과 비교할 현재 관측 저장
        previous = current
        # 리플레이 관측의 후속 연결 제외 여부 확인
        if current.is_replay is True:
            # 리플레이 관측 건너뜀
            continue

        # 동시 중단·재개 입력의 모순
        preparing = (
            current.preparation_detected is True if visual_pattern else current.dead_ball is True
        )
        # 모드에 맞춰 출발 패턴 또는 공 재개 사실 선택
        departing = (
            current.departure_detected is True if visual_pattern else current.ball_restarted is True
        )
        # 패턴 출발 또는 경기 중단 해제로 재개 진행 확인
        resuming = departing if visual_pattern else current.dead_ball is False
        # 준비와 출발 신호의 동시 입력 확인
        if preparing and departing:
            # 상충한 신호 사유로 열린 사건 마감
            episode(current.timestamp_ms, "CONTRADICTORY_SIGNALS")
            # 모순된 사건의 시작 시각 초기화
            start = None
            # 모순된 관측의 추가 결합 건너뜀
            continue
        # 아직 시작하지 않은 사건 여부 확인
        if start is None:
            # 준비 관측 또는 뒷받침 증거의 부재 확인
            if not preparing or not current.evidence_ids:
                # 사건 시작 근거가 부족한 관측 건너뜀
                continue
            # 현재 시각으로 새 사건 시작
            start = current.timestamp_ms
            # 새 사건의 유형 후보 집합 초기화
            possible = set()
            # 새 사건의 증거 집합 초기화
            evidence = set()
            # 새 사건의 후보 충돌 상태 초기화
            conflict = False
            # 새 사건의 본방송 출처 확인 누적값 초기화
            source_known = True

        # 원본 미확인·근거 공백의 긍정 판별 차단과 후속 입력에도 보존
        source_known = source_known and current.is_replay is False
        # 선택한 모드에서 필요한 상태 관측의 누락 확인
        state_missing = (
            current.preparation_detected is None and current.departure_detected is None
            if visual_pattern
            else current.dead_ball is None
        )
        # 증거 또는 상태 관측 누락 여부 확인
        if not current.evidence_ids or state_missing:
            # 근거 공백 사유로 열린 사건 마감
            episode(current.timestamp_ms, "OBSERVATION_MISSING")
            # 근거가 끊긴 사건의 시작 시각 초기화
            start = None
            # 불완전한 관측의 후속 연결 건너뜀
            continue
        # 현재 관측의 증거 식별자 누적
        evidence.update(current.evidence_ids)
        # 현재 관측의 재개 유형 후보 집합 생성
        incoming = set(current.restart_candidates)
        # 재개 후 위치의 중단 시점 소급 금지
        if preparing and incoming:
            # 이전 재개 유형 후보의 부재 확인
            if not possible:
                # 첫 재개 유형 후보로 현재 입력 채택
                possible = incoming
            # 기존 유형 후보와 새 근거의 일치 여부 확인
            else:
                # 과거 후보와 현재 후보의 공통 유형 계산
                overlap = possible & incoming
                # 일치하는 재개 유형 후보 존재 확인
                if overlap:
                    # 양쪽 관측이 지지하는 공통 후보만 유지
                    possible = overlap
                # 공통 재개 유형이 없는 충돌 분기
                else:
                    # 서로 양립하지 않는 재개 유형 충돌 기록
                    conflict = True
                    # 충돌한 양쪽 후보를 잃지 않도록 합집합 보존
                    possible |= incoming
        # 재개 진행 관측 여부 확인
        if resuming:
            # 출발 또는 공 재개 근거의 존재 확인
            if departing:
                # 현재 시각을 재개 시각으로 사건 마감
                episode(current.timestamp_ms, None, current.timestamp_ms)
            # 재개 상태만 바뀌고 출발 근거가 없는 경우 분기
            else:
                # 실제 재개 관측 부재 사유로 사건 마감
                episode(current.timestamp_ms, "RESTART_NOT_OBSERVED")
            # 마감한 사건의 시작 시각 초기화
            start = None

    # 입력 종료 때 열린 사건이 남았는지 확인
    if start is not None and previous:
        # 재개 전 영상 종료 사유로 마지막 사건 마감
        episode(previous.timestamp_ms, "CLIP_ENDED_BEFORE_RESTART")
    # 시간 순서로 누적된 재개 사건의 불변 묶음 반환
    return tuple(events)
