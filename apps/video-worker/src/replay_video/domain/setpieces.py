from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal


RestartKind = Literal["KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"]
RESTART_KINDS = frozenset({"KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"})


@dataclass(frozen=True, slots=True)
class RestartObservation:
    # 시간은 원본 파일 기준이며 연속 구간이 바뀌면 이전 관찰을 이어 붙이지 않는다
    timestamp_ms: int
    continuity_id: int
    dead_ball: bool | None = None
    ball_restarted: bool | None = None
    restart_candidates: tuple[RestartKind, ...] = ()
    evidence_ids: tuple[str, ...] = ()
    # None은 본방송 여부도 아직 확인하지 못한 상태다
    is_replay: bool | None = None


@dataclass(frozen=True, slots=True)
class RestartEvent:
    start_ms: int
    end_ms: int
    restart_ms: int | None
    status: Literal["OBSERVED", "UNKNOWN"]
    kind: str
    candidates: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    reasons: tuple[str, ...]


def setpieces(observations: Iterable[RestartObservation], max_gap_ms: int = 1500) -> tuple[RestartEvent, ...]:
    """근거가 있는 중단과 재개 순서만 묶으며 영상 픽셀이나 경기규칙을 해석하지 않는다"""
    if type(max_gap_ms) is not int or max_gap_ms <= 0:
        raise ValueError("invalid-observation-gap")
    events: list[RestartEvent] = []
    previous: RestartObservation | None = None
    start: int | None = None
    possible: set[str] = set()
    evidence: set[str] = set()
    conflict = False
    source_known = True

    def finish(end: int, reason: str | None, restart: int | None = None) -> None:
        # 관찰된 순서가 완전해도 입력 후보가 충돌하면 한 종류로 확정하지 않는다
        if start is None:
            return
        reasons = [reason] if reason else []
        if not possible:
            reasons.append("RESTART_TYPE_MISSING")
        if conflict or len(possible) > 1:
            reasons.append("RESTART_TYPE_AMBIGUOUS")
        if not source_known:
            reasons.append("BROADCAST_SOURCE_UNKNOWN")
        observed = not reasons and restart is not None and len(possible) == 1
        events.append(RestartEvent(
            start, end, restart, "OBSERVED" if observed else "UNKNOWN",
            next(iter(possible)) if observed else "UNKNOWN",
            tuple(sorted(possible)), tuple(sorted(evidence)), tuple(reasons),
        ))

    for current in observations:
        # bool은 int의 하위 타입이므로 원본 시간 검증에서 별도로 제외한다
        if type(current.timestamp_ms) is not int or current.timestamp_ms < 0:
            raise ValueError("invalid-observation-time")
        if previous and current.timestamp_ms <= previous.timestamp_ms:
            raise ValueError("observation-time-not-increasing")
        if any(value not in RESTART_KINDS for value in current.restart_candidates):
            raise ValueError("invalid-restart-kind")
        if any(value is not None and type(value) is not bool for value in (current.dead_ball, current.ball_restarted, current.is_replay)):
            raise ValueError("invalid-observation-state")

        # 컷과 긴 공백은 실제 재개인지 알 수 없으므로 열린 사건을 미확인으로 닫는다
        boundary = None
        if previous and current.continuity_id != previous.continuity_id:
            boundary = "SHOT_CHANGED"
        elif previous and current.timestamp_ms - previous.timestamp_ms > max_gap_ms:
            boundary = "OBSERVATION_GAP"
        elif current.is_replay is True:
            boundary = "REPLAY_ENTERED"
        if boundary:
            finish(previous.timestamp_ms if previous else current.timestamp_ms, boundary)
            start = None
        previous = current
        if current.is_replay is True:
            continue

        # 중단 여부와 재개 여부가 동시에 참이면 입력 자체가 모순이다
        if current.dead_ball is True and current.ball_restarted is True:
            finish(current.timestamp_ms, "CONTRADICTORY_SIGNALS")
            start = None
            continue
        if start is None:
            if current.dead_ball is not True or not current.evidence_ids:
                continue
            start = current.timestamp_ms
            possible = set()
            evidence = set()
            conflict = False
            source_known = True

        # 소스 미확인과 근거 공백은 양성 판별을 막고 이후 입력으로 지워지지 않는다
        source_known = source_known and current.is_replay is False
        if not current.evidence_ids or current.dead_ball is None:
            finish(current.timestamp_ms, "OBSERVATION_MISSING")
            start = None
            continue
        evidence.update(current.evidence_ids)
        incoming = set(current.restart_candidates)
        # 재개 후 위치를 중단 시점의 재개 위치로 소급하지 않는다
        if current.dead_ball is True and incoming:
            if not possible:
                possible = incoming
            else:
                overlap = possible & incoming
                if overlap:
                    possible = overlap
                else:
                    conflict = True
                    possible |= incoming
        if current.dead_ball is False:
            if current.ball_restarted is True:
                finish(current.timestamp_ms, None, current.timestamp_ms)
            else:
                finish(current.timestamp_ms, "RESTART_NOT_OBSERVED")
            start = None

    if start is not None and previous:
        finish(previous.timestamp_ms, "CLIP_ENDED_BEFORE_RESTART")
    return tuple(events)
