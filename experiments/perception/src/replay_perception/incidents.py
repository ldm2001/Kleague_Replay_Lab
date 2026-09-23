# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본과 분리된 사본 생성 도구 읽음
from copy import copy
# 허용된 상태를 이름으로 구분할 열거형 읽음
from enum import Enum
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
from hashlib import sha256
# 서로 다른 관측의 조합을 만들 도구 읽음
from itertools import combinations
# 기록과 설정을 직렬화할 도구 읽음
import json
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import hypot, isfinite
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 영상 읽기 관련 함수와 자료형 읽음
from .media import timestamp
# 관측 목록 관련 함수와 자료형 읽음
from .observations import RoleHypothesis
# 프레임 목록 관련 함수와 자료형 읽음
from .frames import RecordedFrame


# 관측 연결을 허용할 공백 상한 밀리초를 250 값으로 설정
MAX_GAP_MS = 250
# 최댓값 연결 지연 밀리초를 3000 값으로 설정
MAX_LINK_DELAY_MS = 3000


# 판정 단계의 필드와 동작을 묶을 자료형 선언
class DecisionPhase(str, Enum):
    # 확인 불가를 확인 불가 값으로 설정
    UNKNOWN = "UNKNOWN"
    # 초기를 초기 값으로 설정
    INITIAL = "INITIAL"
    # 수정된을 수정된 값으로 설정
    REVISED = "REVISED"
    # 최종을 최종 값으로 설정
    FINAL = "FINAL"


# 접촉 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class ContactObservation:
    # 화면 근접만으로 접촉·부위·강도 측정 불가
    state: str = "UNVERIFIED"


# 원심 판정 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class OriginalDecisionObservation:
    # 승인된 신호 의미 생성기의 선언값 공급 없음
    phase: DecisionPhase = DecisionPhase.UNKNOWN
    # 값을 아직 없는 상태로 초기화
    value: str | None = None
    # 독립 근거 식별자 목록을 모를 빈 자료 생성
    independent_evidence_ids: tuple[str, ...] = ()

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 단계 필드 기록
            "phase": self.phase.value,
            # 값 필드 기록
            "value": self.value,
            # 독립 근거 식별자 목록 필드 기록
            "independentEvidenceIds": list(self.independent_evidence_ids),
        }


# 재개 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class RestartObservation:
    # 상태를 미검증 값으로 설정
    state: str = "UNVERIFIED"
    # 종류를 아직 없는 상태로 초기화
    kind: str | None = None

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {"state": self.state, "kind": self.kind}

# 관측 식별자의 형식과 충돌 방지 조건을 확인
def identifier(kind: str, value: object) -> str:
    # 해시 누적기에 문자열로 표현한 내용 해시 저장
    digest = sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    # 현재 값을 포함한 문자열 반환
    return f"{kind}-{digest}"


# 시간축의 필드와 동작을 묶을 자료형 선언
class _Timeline:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 마지막 밀리초를 아직 없는 상태로 초기화
        self.last_ms: int | None = None
        # 마지막 시간을 아직 없는 상태로 초기화
        self.last_time: Fraction | None = None
        # 연속 구간 식별자를 아직 없는 상태로 초기화
        self.continuity_id: int | None = None
        # 원본을 아직 없는 상태로 초기화
        self.source = None

    # 샷과 추적 연속성을 확인해 사건 시간축을 갱신
    def transition(self, frame: RecordedFrame) -> bool:
        # 표본에 프레임의 표본 저장
        sample = frame.sample
        # 원본 시작점 기준 경과 시간에 원본 표시 시각 눈금 및 눈금당 초 단위 시간의 곱 및 시작점 표시 시각 눈금 및 시작점 눈금당 초 단위 시간의 곱의 차이 저장
        relative_time = sample.pts * sample.time_base - sample.origin_pts * sample.origin_time_base
        # 프레임 시각 표시 시각 눈금 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if sample.timestamp_ms != timestamp(
            sample.pts, sample.time_base, sample.origin_pts, sample.origin_time_base
        ):
            # 프레임 시각 표시 시각 눈금 불일치 오류 알림
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        # 원본을 다음 항목으로 구성
        source = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        # 원본 범위 변경을 감지해 잘못된 입력의 후속 사용 차단
        if self.source is not None and source != self.source:
            # 원본 범위 변경 오류 알림
            raise ValueError("SOURCE_SCOPE_CHANGED")
        # 시간축 아닌 시간순을 감지해 잘못된 입력의 후속 사용 차단
        if self.last_ms is not None and sample.timestamp_ms <= self.last_ms:
            # 시간축 아닌 시간순 오류 알림
            raise ValueError("TIMELINE_NON_MONOTONIC")
        # 화면 구간이 바뀌거나 관측 공백이 길면 앞선 사건 후보와 연결하지 않도록 경계 확인
        boundary = self.continuity_id != frame.continuity_id or (
            self.last_time is not None
            and relative_time - self.last_time > Fraction(MAX_GAP_MS, 1000)
        )
        # 마지막 밀리초·연속 구간 식별자·원본을 다음 항목으로 구성
        self.last_ms, self.continuity_id, self.source = (
            sample.timestamp_ms,
            frame.continuity_id,
            source,
        )
        # 마지막 시간에 원본 시작점 기준 경과 시간 저장
        self.last_time = relative_time
        # 경계 반환
        return boundary


# 상호작용 추적기의 필드와 동작을 묶을 자료형 선언
class InteractionTracker:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 시간축에 시간축 처리 결과 저장
        self._timeline = _Timeline()
        # 활성을 모를 빈 자료 생성
        self._active: dict[tuple[str, str], dict[str, Any]] = {}

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self, frame: RecordedFrame, roles: tuple[RoleHypothesis, ...]
    ) -> tuple[dict[str, Any], ...]:
        # 입력 검사가 실패해도 기존 시간축 상태가 바뀌지 않도록 사본에서 진행
        timeline = copy(self._timeline)
        # 경계에 연속성 전환 처리 결과 저장
        boundary = timeline.transition(frame)
        # 활성에 조건에 따라 선택한 빈 사전 저장
        active = {} if boundary else self._active
        # 역할 기준 식별자에 역할 목록의 항목별 변환 결과 저장
        role_by_id = {item.detection_id: item for item in roles}
        # 역할 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(role_by_id) != len(roles):
            # 역할 식별자 중복 오류 알림
            raise ValueError("ROLE_ID_DUPLICATE")
        # 역할 식별자 목록에 역할 목록에서 조건에 맞는 항목을 모은 값 저장
        role_ids = [item.role_detection_id for item in roles if item.status == "MATCHED"]
        # 역할 연결 모호한을 감지해 잘못된 입력의 후속 사용 차단
        if len(role_ids) != len(set(role_ids)):
            # 역할 연결 모호한 오류 알림
            raise ValueError("ROLE_ASSOCIATION_AMBIGUOUS")
        # 식별자 목록에 프레임의 검출 목록의 항목별 변환 결과 저장
        ids = [item.detection_id for item in frame.detections]
        # 추적 목록에 프레임의 검출 목록에서 조건에 맞는 항목을 모은 값 저장
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        # 상호작용 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(ids) != len(set(ids)) or len(tracks) != len(set(tracks)):
            # 상호작용 식별자 중복 오류 알림
            raise ValueError("INTERACTION_ID_DUPLICATE")
        # 선수 목록을 모를 빈 자료 생성
        players = []
        # 프레임의 검출 목록에서 항목을 하나씩 읽음
        for item in frame.detections:
            # 역할에 항목의 검출 식별자의 키에 해당하는 값 저장
            role = role_by_id.get(item.detection_id)
            # 레이블 및 사람의 일치 조건 및 구간 안에서만 유효한 추적 식별자가 있는지 및 역할이 있는지 확인
            if (
                item.label == "person"
                and item.track_id is not None
                and role is not None
                and role.status == "MATCHED"
                and role.role == "player"
            ):
                # 선수 목록에 항목 추가
                players.append(item)
        # 상호작용 사람 한도를 감지해 잘못된 입력의 후속 사용 차단
        if len(players) > 64:
            # 상호작용 사람 한도 오류 알림
            raise ValueError("INTERACTION_PERSON_LIMIT")
        # 현재를 모를 빈 자료 생성
        current = {}
        # 서로 다른 항목의 조합 처리 결과에서 첫 번째·두 번째를 하나씩 읽음
        for first, second in combinations(players, 2):
            # 여러 값을 순서대로 모은 자료에 첫 번째의 원본 화면의 시작점과 끝점 상자 좌표 저장
            ax1, ay1, ax2, ay2 = first.box
            # 여러 값을 순서대로 모은 자료에 두 번째의 원본 화면의 시작점과 끝점 상자 좌표 저장
            bx1, by1, bx2, by2 = second.box
            # 두 사람의 화면상 상자 높이를 평균해 근접 거리 비교 기준 생성
            scale = ((ay2 - ay1) + (by2 - by1)) / 2
            # 배율 및 64의 미만 조건 확인
            if scale < 64:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 두 상자가 가로로 겹치면 영으로 두고 떨어진 가로 간격만 계산
            horizontal_gap = max(ax1 - bx2, bx1 - ax2, 0)
            # 두 상자가 세로로 겹치면 영으로 두고 떨어진 세로 간격만 계산
            vertical_gap = max(ay1 - by2, by1 - ay2, 0)
            # 관측 공백에 직각 성분으로 구한 거리 저장
            gap = hypot(horizontal_gap, vertical_gap)
            # 지면의 실제 깊이가 아닌 두 상자 아래쪽 세로 좌표 차이 계산
            foot_depth = abs(ay2 - by2)
            # 화면상 거리와 상자 아래쪽 차이가 신체 크기 대비 큰 후보 제외
            if gap > .12 * scale or foot_depth > .4 * scale:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 짝에 기준 순으로 정렬한 목록의 순서를 고정한 튜플 변환 결과 저장
            pair = tuple(sorted((first.track_id, second.track_id)))
            # 이전에 짝의 키에 해당하는 값 저장
            previous = active.get(pair)
            # 밀리초에 프레임의 표본의 원본 시작점 기준 밀리초 저장
            ms = frame.sample.timestamp_ms
            # 시작에 조건에 따라 선택한 이전의 시작 밀리초 저장
            start = previous["startMs"] if previous is not None else ms
            # 동일성 정보를 다음 항목으로 구성
            identity = [
                frame.sample.stream_index,
                frame.sample.origin_pts,
                str(frame.sample.origin_time_base),
                frame.continuity_id,
                pair,
                start,
            ]
            # 현재의 선택 항목을 다음 항목으로 구성
            current[pair] = {
                # 식별자 필드 기록
                "id": identifier("interaction", identity),
                # 종류 필드 기록
                "kind": "IMAGE_PROXIMITY",
                # 연속 구간 식별자 필드 기록
                "continuityId": frame.continuity_id,
                # 행위자 추적 식별자 목록 필드 기록
                "actorTrackIds": list(pair),
                # 시작 밀리초 필드 기록
                "startMs": start,
                # 종료 밀리초 필드 기록
                "endMs": ms,
                # 지지 관측 프레임 수량 필드 기록
                "supportFrameCount": previous["supportFrameCount"] + 1 if previous else 1,
                # 발 점 필드 기록
                "footPoint": [(ax1 + ax2 + bx1 + bx2) / 4, (ay2 + by2) / 2],
                # 사람 높이 화소 단위 필드 기록
                "personHeightPx": scale,
                # 상자 관측 공백 화소 단위 필드 기록
                "boxGapPx": gap,
                # 발 깊이 차이 화소 단위 필드 기록
                "footDepthDifferencePx": foot_depth,
                # 접촉 필드 기록
                "contact": ContactObservation().state,
                # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
                "admission": "NOT_ADMITTED",
                # 방법 필드 기록
                "method": "tracked-player-image-proximity-v1",
                # 마지막 프레임 필드 기록
                "lastFrame": frame.sample.as_record(),
                # 사유 목록 필드 기록
                "reasons": ["BOX_PROXIMITY_NOT_CONTACT", "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY"],
            }
        # 상호작용 짝 한도를 감지해 잘못된 입력의 후속 사용 차단
        if len(current) > 128:
            # 상호작용 짝 한도 오류 알림
            raise ValueError("INTERACTION_PAIR_LIMIT")
        # 활성에 현재 저장
        self._active = current
        # 시간축에 시간축 저장
        self._timeline = timeline
        # 저장된 값 목록의 순서를 고정한 튜플 변환 결과 반환
        return tuple(current.values())

# 좌표 쌍이 유한한 수치로 구성됐는지 확인
def validPoint(value: object) -> bool:
    # 좌표 쌍의 길이가 둘이며 각 값이 참거짓을 제외한 유한 수치인지 반환
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and all(type(item) in (int, float) and isfinite(item) for item in value)
    )

# 관측 원본 시각의 정확한 유리수 복원
def recordTime(value: dict[str, Any]) -> Fraction:
    # 기준·시작점을 다음 항목으로 구성
    base, origin = value["timeBase"], value["originTimeBase"]
    # 원본 눈금 시간에서 시작점 눈금 시간을 빼 정확한 경과 유리수 반환
    return value["pts"] * Fraction(base["numerator"], base["denominator"]) - value[
        "originPts"
    ] * Fraction(origin["numerator"], origin["denominator"])


# 사건 후보 연결기의 필드와 동작을 묶을 자료형 선언
class IncidentLinker:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 시간축에 시간축 처리 결과 저장
        self._timeline = _Timeline()
        # 최근을 모를 빈 자료 생성
        self._recent: dict[str, dict[str, Any]] = {}

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        frame: RecordedFrame,
        interactions: tuple[dict[str, Any], ...],
        officials: tuple[dict[str, Any], ...],
        *,
        restart_patterns: tuple[dict[str, Any], ...] = (),
    ) -> tuple[dict[str, Any], ...]:
        # 입력 검사가 실패해도 기존 시간축 상태가 바뀌지 않도록 사본에서 진행
        timeline = copy(self._timeline)
        # 경계에 연속성 전환 처리 결과 저장
        boundary = timeline.transition(frame)
        # 밀리초에 프레임의 표본의 원본 시작점 기준 밀리초 저장
        ms = frame.sample.timestamp_ms
        # 이전에 조건에 따라 선택한 빈 사전 저장
        previous = {} if boundary else self._recent
        # 식별자 목록에 프레임의 검출 목록의 항목별 변환 결과 저장
        ids = [item.detection_id for item in frame.detections]
        # 추적 목록에 프레임의 검출 목록에서 조건에 맞는 항목을 모은 값 저장
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        # 상호작용 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(ids) != len(set(ids)) or len(tracks) != len(set(tracks)):
            # 상호작용 식별자 중복 오류 알림
            raise ValueError("INTERACTION_ID_DUPLICATE")
        # 현재 추적 목록에 프레임의 검출 목록에서 조건에 맞는 항목을 모은 값 저장
        current_tracks = {
            item.track_id: item for item in frame.detections if item.track_id is not None
        }
        # 현재 시간에 기록 시간 처리 결과 저장
        current_time = recordTime(frame.sample.as_record())
        # 연결 시간 한도 안에 있고 두 행위자의 추적이 현재도 있는 사건 후보만 보존
        recent = {
            key: value
            for key, value in previous.items()
            if 0
            <= current_time - recordTime(value["lastFrame"])
            <= Fraction(MAX_LINK_DELAY_MS, 1000)
            and all(track in current_tracks for track in value["actorTrackIds"])
        }
        # 상호작용 목록에서 항목을 하나씩 읽음
        for item in interactions:
            # 관측 프레임 불일치를 감지해 잘못된 입력의 후속 사용 차단
            if item.get("lastFrame") != frame.sample.as_record():
                # 관측 프레임 불일치 오류 알림
                raise ValueError("OBSERVATION_FRAME_MISMATCH")
            # 항목의 연속 구간 식별자 및 연속 구간 식별자의 일치 조건 및 항목의 종료 밀리초 및 밀리초의 일치 조건 확인
            if item["continuityId"] == frame.continuity_id and item["endMs"] == ms:
                # 최근의 선택 항목에 항목 저장
                recent[item["id"]] = item
        # 사건 후보 연결 한도를 감지해 잘못된 입력의 후속 사용 차단
        if len(recent) > 512:
            # 사건 후보 연결 한도 오류 알림
            raise ValueError("INCIDENT_LINK_LIMIT")
        # 연결 목록을 모를 빈 자료 생성
        links = []
        # 심판 후보 목록에서 심판 후보를 하나씩 읽음
        for official in officials:
            # 관측 프레임 불일치를 감지해 잘못된 입력의 후속 사용 차단
            if official.get("lastFrame") != frame.sample.as_record():
                # 관측 프레임 불일치 오류 알림
                raise ValueError("OBSERVATION_FRAME_MISMATCH")
            # 연속 구간 식별자의 키에 해당하는 값 및 연속 구간 식별자의 불일치 조건 또는 시각 밀리초의 키에 해당하는 값 및 밀리초의 불일치 조건 또는 연속 지지 조건 충족의 키에 해당하는 값 및 참의 다른 객체 조건 확인
            if (
                official.get("continuityId") != frame.continuity_id
                or official.get("timestampMs") != ms
                or official.get("sustained") is not True
                or official.get("officialRole") not in ("MAIN_CANDIDATE", "ASSISTANT_CANDIDATE")
                or official.get("trackId") not in current_tracks
                or not validPoint(official.get("footPoint"))
            ):
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 가능성 목록을 모를 빈 자료 생성
            possibilities = []
            # 저장된 값 목록에서 상호작용을 하나씩 읽음
            for interaction in recent.values():
                # 행위자 목록에 상호작용의 행위자 추적 식별자 목록의 항목별 변환 결과 저장
                actors = [current_tracks.get(track) for track in interaction["actorTrackIds"]]
                # 행위자 목록의 항목 수 및 2의 불일치 조건 또는 행위자 목록의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
                if len(actors) != 2 or any(actor is None for actor in actors):
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 같은 추적 조각을 현재 프레임으로 재투영
                # 움직이는 카메라의 이전 화면 좌표를 지면 위치로 재사용 금지
                point = [
                    sum((actor.box[0] + actor.box[2]) / 2 for actor in actors) / 2,
                    sum(actor.box[3] for actor in actors) / 2,
                ]
                # 두 사람의 화면상 상자 높이를 평균해 근접 거리 비교 기준 생성
                scale = sum(actor.box[3] - actor.box[1] for actor in actors) / 2
                # 배율 및 64의 미만 조건 또는 수치 연산 결과의 절댓값 및 수치 연산 결과의 초과 조건 확인
                if scale < 64 or abs(actors[0].box[3] - actors[1].box[3]) > .4 * scale:
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 가로 차이·세로 차이를 다음 항목으로 구성
                dx, dy = official["footPoint"][0] - point[0], official["footPoint"][1] - point[1]
                # 화면상의 거리를 사람 높이로 나누어 원근에 민감한 근접 비교값 계산
                normalized_distance = hypot(dx, dy) / scale
                # 정규화한 거리 및 2의 이하 조건 확인
                if normalized_distance <= 2:
                    # 가능성 목록에 상호작용·정규화한 거리 추가
                    possibilities.append((interaction, normalized_distance))
            # 근접만으로 연결하지 않으며 복수 사건이 가능하면 보류
            if len(possibilities) != 1:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 상호작용·거리에 가능성 목록의 선택 항목 저장
            interaction, distance = possibilities[0]
            # 근접과 신호 가설을 접촉이나 원심 및 재개 사실로 확정할 수 없는 사유 기록
            reasons = [
                "BOX_PROXIMITY_NOT_CONTACT",
                "SIGNAL_MEANING_UNVALIDATED",
                "LIVE_REPLAY_UNVERIFIED",
                "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
                "RESTART_PATTERN_NOT_LINKED" if restart_patterns else "RESTART_NOT_VISIBLE",
            ]
            # 연결 목록에 필드별로 묶은 기록 추가
            links.append(
                {
                    # 식별자 필드 기록
                    "id": identifier(
                        "link",
                        [
                            interaction["id"],
                            official["trackId"],
                            official["startMs"],
                            official["signalKind"],
                        ],
                    ),
                    # 연결 상태 필드 기록
                    "linkState": "CANDIDATE_LINK",
                    # 연속 구간 식별자 필드 기록
                    "continuityId": frame.continuity_id,
                    # 시작 밀리초 필드 기록
                    "startMs": min(interaction["startMs"], official["startMs"]),
                    # 종료 밀리초 필드 기록
                    "endMs": ms,
                    # 상호작용 식별자 필드 기록
                    "interactionId": interaction["id"],
                    # 행위자 추적 식별자 목록 필드 기록
                    "actorTrackIds": interaction["actorTrackIds"],
                    # 심판 후보 추적 식별자 필드 기록
                    "officialTrackId": official["trackId"],
                    # 심판 후보 역할 필드 기록
                    "officialRole": official["officialRole"],
                    # 신호 단서 종류 필드 기록
                    "signalKind": official["signalKind"],
                    # 영상 거리 신체 비율 필드 기록
                    "imageDistanceBodyRatio": distance,
                    # 지연 밀리초 필드 기록
                    "delayMs": ms - interaction["endMs"],
                    # 접촉 필드 기록
                    "contact": ContactObservation().state,
                    # 선언된 원심의 확인 상태 필드 기록
                    "originalDecision": OriginalDecisionObservation().as_record(),
                    # 재개 필드 기록
                    "restart": RestartObservation().as_record(),
                    # 사유 목록 필드 기록
                    "reasons": reasons,
                    # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
                    "admission": "NOT_ADMITTED",
                    # 방법 필드 기록
                    "method": "same-context-observation-link-v1",
                }
            )
        # 최근·시간축을 다음 항목으로 구성
        self._recent, self._timeline = recent, timeline
        # 연결 목록의 순서를 고정한 튜플 변환 결과 반환
        return tuple(links)
