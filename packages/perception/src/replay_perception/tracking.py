# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 호출 가능한 객체의 자료형 규약 읽음
from collections.abc import Callable
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import replace
# 설치 라이브러리 버전 조회 도구 읽음
from importlib.metadata import version
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import isfinite
# 불리언과 수치 자료형을 구별할 기준 읽음
from numbers import Integral, Real
# 입출력 자료형과 호출 규약 읽음
from typing import Any, Protocol
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 외부 추적기와 주고받을 검출 배열 규격 읽음
import supervision as sv
# 시간 기반 검출 연결을 위한 추적기 읽음
from trackers import ByteTrackTracker
# 추적기 목록 보조 도구 상태 표현 관련 함수와 자료형 읽음
from trackers.utils.state_representations import XCYCSRStateEstimator
# 모델 목록 관련 함수와 자료형 읽음
from .models import LABELS, Detection


# 다른 장면을 같은 추적으로 잇지 않기 위한 최대 관측 공백을 1500 값으로 설정
_MAXIMUM_GAP_MS = 1_500
# 추적기 설정을 다음 항목으로 구성
_TRACKER_SETTINGS: dict[str, Any] = {
    # 누락된 추적 추적 메모리 버퍼 필드 기록
    "lost_track_buffer": 30,
    # 추적 활성화 임계값 필드 기록
    "track_activation_threshold": 0.7,
    # 하한 연속 프레임 목록 필드 기록
    "minimum_consecutive_frames": 2,
    # 하한 교집합 합집합 면적 비율 임계값 필드 기록
    "minimum_iou_threshold": 0.1,
    # 상한 점수 검출 임계값 필드 기록
    "high_conf_det_threshold": 0.6,
    # 상태 추정기 클래스 필드 기록
    "state_estimator_class": XCYCSRStateEstimator,
}


# 추적기의 필드와 동작을 묶을 자료형 선언
class _Tracker(Protocol):

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        detections: sv.Detections,
        *,
        timestamp: float,
    ) -> sv.Detections: ...


# 추적기 생성 함수에 호출 가능 규약의 선택 항목 저장
TrackerFactory = Callable[..., _Tracker]


# 추적 추적 연결기의 필드와 동작을 묶을 자료형 선언
class TrackAssociator:
    """현재 프레임 검출 관측에 추적 식별자 연결"""

    # 초기 상태·입력 계약 구성
    def __init__(
        self,
        frame_rate: float = 2,
        *,
        _tracker_factory: TrackerFactory = ByteTrackTracker,
    ) -> None:
        # 프레임 빈도 지원하지 않음을 감지해 잘못된 입력의 후속 사용 차단
        if (
            not isinstance(frame_rate, Real)
            or isinstance(frame_rate, bool)
            or not isfinite(frame_rate)
            or frame_rate <= 0
        ):
            # 프레임 빈도 지원하지 않음 오류 알림
            raise ValueError("FRAME_RATE_UNSUPPORTED")
        # 추적기 생성 함수의 자료 형식과 허용 조건 확인
        if not callable(_tracker_factory):
            # 추적기 생성 함수 유효하지 않음 오류 알림
            raise ValueError("TRACKER_FACTORY_INVALID")

        # 프레임 빈도에 프레임 빈도의 실수 변환 결과 저장
        self._frame_rate = float(frame_rate)
        # 추적기 생성 함수에 추적기 생성 함수 저장
        self._tracker_factory = _tracker_factory
        # 출처 정보를 다음 항목으로 구성
        self.provenance = {
            # 라이브러리 필드 기록
            "library": "roboflow/trackers",
            # 라이브러리 버전 필드 기록
            "library_version": version("trackers"),
            # 추적기 필드 기록
            "tracker": "ByteTrackTracker",
            # 프레임 빈도 필드 기록
            "frame_rate": self._frame_rate,
            # 누락된 추적 추적 메모리 버퍼 필드 기록
            "lost_track_buffer": _TRACKER_SETTINGS["lost_track_buffer"],
            # 추적 활성화 임계값 필드 기록
            "track_activation_threshold": _TRACKER_SETTINGS["track_activation_threshold"],
            # 하한 연속 프레임 목록 필드 기록
            "minimum_consecutive_frames": _TRACKER_SETTINGS["minimum_consecutive_frames"],
            # 하한 교집합 합집합 면적 비율 임계값 필드 기록
            "minimum_iou_threshold": _TRACKER_SETTINGS["minimum_iou_threshold"],
            # 상한 점수 검출 임계값 필드 기록
            "high_conf_det_threshold": _TRACKER_SETTINGS["high_conf_det_threshold"],
            # 상태 추정기 필드 기록
            "state_estimator": XCYCSRStateEstimator.__name__,
            # 교집합 합집합 면적 비율 필드 기록
            "iou": "IoU",
            # 연결을 허용할 최대 관측 공백 밀리초 필드 기록
            "maximum_gap_ms": _MAXIMUM_GAP_MS,
            # 레이블 분리 필드 기록
            "label_partition": list(LABELS),
        }
        # 세대 번호를 0 값으로 설정
        self._generation = 0
        # 연속 구간 식별자를 아직 없는 상태로 초기화
        self._continuity_id: int | None = None
        # 마지막 시각 밀리초를 아직 없는 상태로 초기화
        self._last_timestamp_ms: int | None = None
        # 추적기 목록에 추적기 목록 처리 결과 저장
        self._trackers = self.trackers()

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        detections: tuple[Detection, ...],
        timestamp_ms: int,
        continuity_id: int,
    ) -> tuple[Detection, ...]:
        # 시각 입력 검사으로 원본 시작점 기준 밀리초의 계약 확인
        self.timestampValidation(timestamp_ms)
        # 연속 구간 입력 검사으로 연속 구간 식별자의 계약 확인
        self.continuityValidation(continuity_id)
        # 검출 입력 검사으로 검출 목록의 계약 확인
        self.detectionValidation(detections)

        # 시간축 아닌 시간순을 감지해 잘못된 입력의 후속 사용 차단
        if self._last_timestamp_ms is not None and timestamp_ms < self._last_timestamp_ms:
            # 시간축 아닌 시간순 오류 알림
            raise ValueError("TIMELINE_NON_MONOTONIC")

        # 화면 연속 구간이 바뀌거나 관측 공백이 길면 같은 행위자라는 연결을 중단할지 확인
        reset_required = self._continuity_id is not None and (
            continuity_id != self._continuity_id
            or timestamp_ms - self._last_timestamp_ms > _MAXIMUM_GAP_MS
        )
        # 초기화 필요한 확인
        if reset_required:
            # 초기화 전후 추적 번호가 우연히 같아도 서로 다른 구간으로 구별
            self._generation += 1
            # 추적기 목록에 추적기 목록 처리 결과 저장
            self._trackers = self.trackers()

        # 할당한을 모를 빈 자료 생성
        assigned: dict[int, str] = {}
        # 사람과 공을 같은 추적에 연결하지 않도록 레이블별 독립 처리
        for label in LABELS:
            # 원본에 검출 목록에서 조건에 맞는 항목을 모은 값의 순서를 고정한 튜플 변환 결과 저장
            source = tuple(value for value in detections if value.label == label)
            # 프로젝트 검출을 추적 라이브러리의 상자와 점수 배열로 변환
            vendor_input = self.vendorDetections(source)
            # 추적된에 갱신 처리 결과 저장
            tracked = self._trackers[label].update(
                vendor_input,
                timestamp=timestamp_ms / 1_000,
            )
            # 추적 출력의 자료형과 원본 식별자 대응을 검사한 뒤 연결 번호 읽음
            vendor_ids = self.vendorIds(tracked, source)
            # 키와 값의 쌍 목록에서 검출 식별자·외부 추적기 식별자를 하나씩 읽음
            for detection_id, vendor_id in vendor_ids.items():
                # 구간과 초기화 세대 및 레이블을 함께 넣어 추적 식별자 충돌 방지
                assigned[detection_id] = f"{continuity_id}:{self._generation}:{label}:{vendor_id}"

        # 연속 구간 식별자에 연속 구간 식별자 저장
        self._continuity_id = continuity_id
        # 마지막 시각 밀리초에 원본 시작점 기준 밀리초 저장
        self._last_timestamp_ms = timestamp_ms
        # 원본 검출 순서와 측정값을 보존하고 승인된 연결의 추적 번호만 덧붙여 반환
        return tuple(
            replace(value, track_id=assigned.get(value.detection_id)) for value in detections
        )

    # 지원 레이블별 독립 추적기 준비
    def trackers(self) -> dict[str, _Tracker]:
        # 레이블 목록의 항목별 변환 결과 반환
        return {
            label: self._tracker_factory(
                frame_rate=self._frame_rate,
                **_TRACKER_SETTINGS,
            )
            for label in LABELS
        }

    # 원본 시각 입력 검사
    @staticmethod
    def timestampValidation(timestamp_ms: object) -> None:
        # 시각의 자료 형식과 허용 조건 확인
        if type(timestamp_ms) is not int or timestamp_ms < 0:
            # 시각 유효하지 않음 오류 알림
            raise ValueError("TIMESTAMP_INVALID")

    # 연속 구간 식별자 검사
    @staticmethod
    def continuityValidation(continuity_id: object) -> None:
        # 연속 구간 식별자의 자료 형식과 허용 조건 확인
        if type(continuity_id) is not int or continuity_id < 0:
            # 연속 구간 식별자 유효하지 않음 오류 알림
            raise ValueError("CONTINUITY_ID_INVALID")

    # 검출 입력 검사
    @staticmethod
    def detectionValidation(detections: object) -> None:
        # 검출 목록의 자료 형식과 허용 조건 확인
        if not isinstance(detections, tuple) or not all(
            isinstance(value, Detection) for value in detections
        ):
            # 검출 목록 유효하지 않음 오류 알림
            raise ValueError("DETECTIONS_INVALID")
        # 식별자 목록에 검출 목록의 항목별 변환 결과 저장
        identifiers = [value.detection_id for value in detections]
        # 검출 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(identifiers) != len(set(identifiers)):
            # 검출 식별자 중복 오류 알림
            raise ValueError("DETECTION_ID_DUPLICATE")

    # 프로젝트 검출을 추적 라이브러리가 요구하는 배열 구조로 변환
    @staticmethod
    def vendorDetections(
        detections: tuple[Detection, ...],
    ) -> sv.Detections:
        # 검출 목록이 비어 있거나 조건을 충족하지 않는지 확인
        if not detections:
            # 빈 자료 처리 결과 반환
            return sv.Detections.empty()
        # 검출 목록 처리 결과 반환
        return sv.Detections(
            xyxy=np.asarray([value.box for value in detections], dtype=np.float64),
            confidence=np.asarray(
                [value.score for value in detections],
                dtype=np.float64,
            ),
            data={
                # 검출 식별자 필드 기록
                "detection_id": np.asarray(
                    [value.detection_id for value in detections],
                    dtype=np.int64,
                )
            },
        )

    # 추적 라이브러리 식별자 읽음
    @staticmethod
    def vendorIds(
        tracked: object,
        source: tuple[Detection, ...],
    ) -> dict[int, int]:
        # 추적기 출력의 자료 형식과 허용 조건 확인
        if not isinstance(tracked, sv.Detections):
            # 추적기 출력 유효하지 않음 오류 알림
            raise ValueError("TRACKER_OUTPUT_INVALID")
        # 추적된의 항목 수 및 0의 일치 조건 확인
        if len(tracked) == 0:
            # 빈 사전 반환
            return {}
        # 추적기 출력의 자료 형식과 허용 조건 확인
        if "detection_id" not in tracked.data or tracked.tracker_id is None:
            # 추적기 출력 유효하지 않음 오류 알림
            raise ValueError("TRACKER_OUTPUT_INVALID")

        # 외부 추적기가 새 검출을 임의로 끼워 넣지 못하도록 원본 식별자 집합 생성
        source_ids = {value.detection_id for value in source}
        # 반환된 원본 식별자 목록에 추적된의 자료의 검출 식별자 저장
        returned_source_ids = tracked.data["detection_id"]
        # 추적기 식별자 목록에 추적된의 추적기 식별자 저장
        tracker_ids = tracked.tracker_id
        # 추적기 출력의 자료 형식과 허용 조건 확인
        if len(returned_source_ids) != len(tracked) or len(tracker_ids) != len(tracked):
            # 추적기 출력 유효하지 않음 오류 알림
            raise ValueError("TRACKER_OUTPUT_INVALID")

        # 결과를 모를 빈 자료 생성
        result: dict[int, int] = {}
        # 이미 확인한에 빈 중복을 없앤 집합 저장
        seen: set[int] = set()
        # 이미 확인한 추적기 식별자 목록에 빈 중복을 없앤 집합 저장
        seen_tracker_ids: set[int] = set()
        # 순서별로 묶은 항목에서 원시 원본 식별자·원시 추적기 식별자를 하나씩 읽음
        for raw_source_id, raw_tracker_id in zip(returned_source_ids, tracker_ids):
            # 추적기 출력의 자료 형식과 허용 조건 확인
            if not isinstance(raw_source_id, Integral) or isinstance(raw_source_id, bool):
                # 추적기 출력 유효하지 않음 오류 알림
                raise ValueError("TRACKER_OUTPUT_INVALID")
            # 원본 식별자에 원시 원본 식별자의 정수 변환 결과 저장
            source_id = int(raw_source_id)
            # 원본에 없는 식별자나 중복 반환된 식별자를 거부
            if source_id not in source_ids or source_id in seen:
                # 추적기 출력 유효하지 않음 오류 알림
                raise ValueError("TRACKER_OUTPUT_INVALID")
            # 이미 확인한에 원본 식별자를 중복 없이 추가
            seen.add(source_id)

            # 추적기 출력의 자료 형식과 허용 조건 확인
            if (
                not isinstance(raw_tracker_id, Integral)
                or isinstance(raw_tracker_id, bool)
                or raw_tracker_id < -1
            ):
                # 추적기 출력 유효하지 않음 오류 알림
                raise ValueError("TRACKER_OUTPUT_INVALID")
            # 추적기 식별자에 원시 추적기 식별자의 정수 변환 결과 저장
            tracker_id = int(raw_tracker_id)
            # 음수인 미할당 추적 번호는 제외하고 실제 할당 번호만 기록
            if tracker_id >= 0:
                # 현재 표본의 두 검출에 같은 추적 번호가 연결되는 경우 거부
                if tracker_id in seen_tracker_ids:
                    # 추적기 출력 유효하지 않음 오류 알림
                    raise ValueError("TRACKER_OUTPUT_INVALID")
                # 이미 확인한 추적기 식별자 목록에 추적기 식별자를 중복 없이 추가
                seen_tracker_ids.add(tracker_id)
                # 결과의 선택 항목에 추적기 식별자 저장
                result[source_id] = tracker_id
        # 결과 반환
        return result
