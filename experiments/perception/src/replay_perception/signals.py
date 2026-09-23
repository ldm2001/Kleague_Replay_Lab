# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
from hashlib import sha256
# 기록과 설정을 직렬화할 도구 읽음
import json
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import acos, degrees, hypot, isclose, isfinite
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 영상 읽기 관련 함수와 자료형 읽음
from .media import timestamp as timestamp_from_pts
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 관측 목록 관련 함수와 자료형 읽음
from .observations import PoseObservation, RoleHypothesis
# 프레임 목록 관련 함수와 자료형 읽음
from .frames import RecordedFrame


# 방향 관절점 목록을 다음 항목으로 구성
_SIDE_KEYPOINTS = (("LEFT", (5, 7, 9, 11)), ("RIGHT", (6, 8, 10, 12)))

# 부동소수점 경계 오차를 고려해 하한 충족 여부를 확인
def minimum(value: float, threshold: float) -> bool:
    # 값 및 임계값의 초과 조건 또는 허용 오차 내 일치 처리 결과 반환
    return value > threshold or isclose(value, threshold, rel_tol=0.0, abs_tol=1e-9)

# 부동소수점 경계 오차를 고려해 상한 충족 여부를 확인
def maximum(value: float, threshold: float) -> bool:
    # 값 및 임계값의 미만 조건 또는 허용 오차 내 일치 처리 결과 반환
    return value < threshold or isclose(value, threshold, rel_tol=0.0, abs_tol=1e-9)

# 측정 불가 사유와 이용 가능한 수치만 관측에 보존
def unobservable(base: dict[str, Any], reason: str, **measures: float) -> dict[str, Any]:
    # 필드별로 묶은 기록 반환
    return {**base, "state": "UNOBSERVABLE", "reasonCode": reason, **measures}

# 한쪽 팔의 관절 기하와 측정 가능 여부를 계산
def armObservation(
    pose: PoseObservation,
    side: str,
    indices: tuple[int, int, int, int],
    width: int,
    height: int,
) -> dict[str, Any]:
    # 여러 값을 순서대로 모은 자료에 순번 목록의 항목별 변환 결과 저장
    shoulder, elbow, wrist, hip = (pose.keypoints[index] for index in indices)
    # 점 목록을 다음 항목으로 구성
    points = (shoulder, elbow, wrist, hip)
    # 기준을 다음 항목으로 구성
    base = {
        # 검출 식별자 필드 기록
        "detectionId": pose.detection_id,
        # 방향 필드 기록
        "side": side,
        # 관절점 순번 목록 필드 기록
        "keypointIndices": list(indices),
        # 원시 하한 관절점 점수 필드 기록
        "rawMinimumKeypointScore": min(point.score for point in points),
    }
    # 여러 값을 순서대로 모은 자료에 자세의 원본 화면의 시작점과 끝점으로 표현한 검출 상자 저장
    x1, y1, x2, y2 = pose.source_box
    # 수치 연산 결과 및 12점0의 미만 조건 또는 수치 연산 결과 및 64점0의 미만 조건 확인
    if x2 - x1 < 12.0 or y2 - y1 < 64.0:
        # 관측 불가 처리 결과 반환
        return unobservable(base, "SOURCE_BOX_TOO_SMALL")
    # 점 목록의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
    if any(point.score < .50 for point in points):
        # 관측 불가 처리 결과 반환
        return unobservable(base, "KEYPOINT_SCORE_BELOW_THRESHOLD")
    # 점 목록의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
    if any(not (0 <= point.x < width and 0 <= point.y < height) for point in points):
        # 관측 불가 처리 결과 반환
        return unobservable(base, "KEYPOINT_OUTSIDE_SOURCE_IMAGE")

    # 어깨와 엉덩이 사이 화면상 거리를 구해 몸 크기에 비례한 비교 기준 생성
    torso_length = hypot(hip.x - shoulder.x, hip.y - shoulder.y)
    # 부정 조건 몸통 길이의 유한 수치 여부 확인
    if not isfinite(torso_length):
        # 관측 불가 처리 결과 반환
        return unobservable(base, "ARM_GEOMETRY_NONFINITE")
    # 몸통 길이 및 8점0의 미만 조건 확인
    if torso_length < 8.0:
        # 관측 불가 처리 결과 반환
        return unobservable(base, "TORSO_LENGTH_BELOW_MINIMUM", torsoLengthPx=torso_length)

    # 어깨와 팔꿈치 사이의 화면상 거리 계산
    upper_arm_length = hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)
    # 팔꿈치와 손목 사이의 화면상 거리 계산
    forearm_length = hypot(wrist.x - elbow.x, wrist.y - elbow.y)
    # 어깨에서 손목까지의 직선 거리 계산
    shoulder_wrist_length = hypot(wrist.x - shoulder.x, wrist.y - shoulder.y)
    # 부정 조건 상한 좌표 팔 길이·아래팔 길이·어깨 손목 길이의 항목별 변환 결과의 전체 조건 충족 여부 확인
    if not all(
        isfinite(value) for value in (upper_arm_length, forearm_length, shoulder_wrist_length)
    ):
        # 관측 불가 처리 결과 반환
        return unobservable(base, "ARM_GEOMETRY_NONFINITE", torsoLengthPx=torso_length)
    # 길이 목록을 다음 항목으로 구성
    lengths = {
        # 몸통 길이 화소 단위 필드 기록
        "torsoLengthPx": torso_length,
        # 상한 좌표 팔 길이 화소 단위 필드 기록
        "upperArmLengthPx": upper_arm_length,
        # 아래팔 길이 화소 단위 필드 기록
        "forearmLengthPx": forearm_length,
        # 어깨 손목 길이 화소 단위 필드 기록
        "shoulderWristLengthPx": shoulder_wrist_length,
    }
    # 각도 계산의 분모가 영이 되는 퇴화 관절 배치 제외
    if min(upper_arm_length, forearm_length, shoulder_wrist_length) == 0:
        # 관측 불가 처리 결과 반환
        return unobservable(base, "ARM_GEOMETRY_DEGENERATE", **lengths)

    # 팔꿈치에서 어깨와 손목으로 향하는 단위 벡터의 내적으로 내각 코사인 계산
    elbow_cosine = ((shoulder.x - elbow.x) / upper_arm_length) * (
        (wrist.x - elbow.x) / forearm_length
    ) + ((shoulder.y - elbow.y) / upper_arm_length) * ((wrist.y - elbow.y) / forearm_length)
    # 반올림 오차를 음의 일부터 일 사이로 제한한 뒤 코사인을 도 단위 내각으로 변환
    elbow_angle = degrees(acos(max(-1.0, min(1.0, elbow_cosine))))
    # 화면 위쪽을 향하는 방향과 어깨에서 손목으로 향하는 방향의 코사인 계산
    vertical_cosine = (shoulder.y - wrist.y) / shoulder_wrist_length
    # 역삼각함수의 정의역을 벗어나지 않도록 제한한 뒤 수직선과의 각도 계산
    vertical_angle = degrees(acos(max(-1.0, min(1.0, vertical_cosine))))
    # 세로 좌표가 아래로 증가하므로 어깨 좌표에서 손목 좌표를 빼 상승량 계산
    wrist_above = shoulder.y - wrist.y
    # 손목 상승과 팔꿈치 펴짐 및 수직 방향을 함께 확인하되 선언된 판정으로 해석하지 않음
    raised = (
        minimum(wrist_above, 0.25 * torso_length)
        and minimum(elbow_angle, 150.0)
        and maximum(vertical_angle, 30.0)
    )
    # 필드별로 묶은 기록 반환
    return {
        **base,
        # 상태 필드 기록
        "state": "ARM_RAISED" if raised else "NOT_RAISED",
        # 사유 상태 코드 필드 기록
        "reasonCode": "ARM_RAISED_CRITERIA_MET" if raised else "ARM_RAISED_CRITERIA_NOT_MET",
        **lengths,
        # 손목 위쪽 차이 어깨 화소 단위 필드 기록
        "wristAboveShoulderPx": wrist_above,
        # 손목 위쪽 차이 어깨 몸통 비율 필드 기록
        "wristAboveShoulderTorsoRatio": wrist_above / torso_length,
        # 팔꿈치 내각 각도 도 단위 필드 기록
        "elbowInteriorAngleDegrees": elbow_angle,
        # 어깨 손목 세로 방향 위쪽 각도 도 단위 필드 기록
        "shoulderWristVerticalUpAngleDegrees": vertical_angle,
    }

# 양팔의 관절 측정을 각각 독립된 관측으로 생성
def armObservations(
    pose: PoseObservation, width: int, height: int
) -> tuple[dict[str, Any], dict[str, Any]]:
    # 프레임 영상 크기의 자료 형식과 허용 조건 확인
    if type(width) is not int or width <= 0 or type(height) is not int or height <= 0:
        # 프레임 영상 크기 유효하지 않음 오류 알림
        raise ValueError("FRAME_DIMENSIONS_INVALID")
    # 왼쪽에 팔 관측 처리 결과 저장
    left = armObservation(pose, _SIDE_KEYPOINTS[0][0], _SIDE_KEYPOINTS[0][1], width, height)
    # 오른쪽에 팔 관측 처리 결과 저장
    right = armObservation(pose, _SIDE_KEYPOINTS[1][0], _SIDE_KEYPOINTS[1][1], width, height)
    # 왼쪽·오른쪽 반환
    return left, right


# 연속 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(slots=True)
class _Run:
    # 연속 구간 식별자를 보관할 자료형 선언
    continuity_id: int
    # 구간 안에서만 유효한 추적 식별자를 보관할 자료형 선언
    track_id: str
    # 방향을 보관할 자료형 선언
    side: str
    # 시작 밀리초를 보관할 자료형 선언
    start_ms: int
    # 마지막 밀리초를 보관할 자료형 선언
    last_ms: int
    # 시작 시간을 보관할 자료형 선언
    start_time: Fraction
    # 마지막 시간을 보관할 자료형 선언
    last_time: Fraction
    # 지지 관측 수량을 보관할 자료형 선언
    support_count: int
    # 시작 프레임을 보관할 자료형 선언
    start_frame: dict[str, Any]
    # 마지막 프레임을 보관할 자료형 선언
    last_frame: dict[str, Any]
    # 기준 충족 밀리초를 아직 없는 상태로 초기화
    confirmed_ms: int | None = None
    # 기준 충족 프레임을 아직 없는 상태로 초기화
    confirmed_frame: dict[str, Any] | None = None

    # 연속 관측의 마지막 시각과 근거 프레임을 보존
    def extension(
        self, timestamp_ms: int, relative_time: Fraction, frame_record: dict[str, Any]
    ) -> None:
        # 마지막 밀리초에 원본 시작점 기준 밀리초 저장
        self.last_ms = timestamp_ms
        # 마지막 시간에 원본 시작점 기준 경과 시간 저장
        self.last_time = relative_time
        # 마지막 프레임에 프레임 기록 저장
        self.last_frame = frame_record
        # 지지 관측 수량에 1을 더해 누적
        self.support_count += 1
        # 기준 충족 밀리초가 없는지 및 지지 관측 수량 및 3의 이상 조건 및 수치 연산 결과 및 반올림 없는 유리수의 이상 조건 확인
        if (
            self.confirmed_ms is None
            and self.support_count >= 3
            and relative_time - self.start_time >= Fraction(1, 5)
        ):
            # 최소 표본 수와 지속 시간을 충족한 시각을 저장하되 신호 의미 확인과 구분
            self.confirmed_ms = timestamp_ms
            # 기준 충족 프레임에 프레임 기록 저장
            self.confirmed_frame = frame_record


# 팔 신호 단서 추적기의 필드와 동작을 묶을 자료형 선언
class ArmSignalTracker:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 활성을 모를 빈 자료 생성
        self._active: dict[tuple[int, str, str], _Run] = {}
        # 관측 구간 계수기를 0 값으로 설정
        self._episode_counter = 0
        # 이전 시각 밀리초를 아직 없는 상태로 초기화
        self._previous_timestamp_ms: int | None = None
        # 이전 표시 시각 눈금 시간을 아직 없는 상태로 초기화
        self._previous_pts_time = None
        # 원본 동일성 정보를 아직 없는 상태로 초기화
        self._source_identity = None
        # 종료 여부를 거짓 값으로 설정
        self._finished = False

    # 원본과 추적 구간 및 관측 종류를 결합해 안정적인 식별자를 생성
    def episodeId(self, run: _Run) -> str:
        # 동일성 정보를 다음 항목으로 구성
        identity = {
            # 계수기 필드 기록
            "counter": self._episode_counter,
            # 스트림 순번 필드 기록
            "streamIndex": run.start_frame["streamIndex"],
            # 시작점 표시 시각 눈금 필드 기록
            "originPts": run.start_frame["originPts"],
            # 시작점 시간 기준 필드 기록
            "originTimeBase": run.start_frame["originTimeBase"],
            # 연속 구간 식별자 필드 기록
            "continuityId": run.continuity_id,
            # 구간 안에서만 유효한 추적 식별자 필드 기록
            "trackId": run.track_id,
            # 방향 필드 기록
            "side": run.side,
            # 시작 표시 시각 눈금 필드 기록
            "startPts": run.start_frame["pts"],
            # 시작 시간 기준 필드 기록
            "startTimeBase": run.start_frame["timeBase"],
        }
        # 해시 누적기에 문자열로 표현한 내용 해시 저장
        digest = sha256(
            json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        # 현재 값을 포함한 문자열 반환
        return f"arm-raised-observation-{digest}"

    # 연속 관측 구간을 닫고 최소 지지 조건을 만족한 기록만 반환
    def closure(self, key: tuple[int, str, str]) -> dict[str, Any] | None:
        # 연속 관측에 제거한 값 처리 결과 저장
        run = self._active.pop(key)
        # 기준 충족 밀리초가 없는지 또는 기준 충족 프레임이 없는지 확인
        if run.confirmed_ms is None or run.confirmed_frame is None:
            # 없음 반환
            return None
        # 관측 구간을 다음 항목으로 구성
        episode = {
            # 관측 구간 식별자 필드 기록
            "episodeId": self.episodeId(run),
            # 종류 필드 기록
            "kind": "ARM_RAISED",
            # 행위자 역할 가설 필드 기록
            "actorRoleHypothesis": "referee",
            # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
            "admission": "NOT_ADMITTED",
            # 연속 구간 식별자 필드 기록
            "continuityId": run.continuity_id,
            # 구간 안에서만 유효한 추적 식별자 필드 기록
            "trackId": run.track_id,
            # 방향 필드 기록
            "side": run.side,
            # 시작 밀리초 필드 기록
            "startMs": run.start_ms,
            # 종료 밀리초 필드 기록
            "endMs": run.last_ms,
            # 기준 충족 밀리초 필드 기록
            "confirmedMs": run.confirmed_ms,
            # 지지 관측 프레임 수량 필드 기록
            "supportFrameCount": run.support_count,
            # 시작 프레임 필드 기록
            "startFrame": run.start_frame,
            # 종료 프레임 필드 기록
            "endFrame": run.last_frame,
            # 기준 충족 프레임 필드 기록
            "confirmedFrame": run.confirmed_frame,
            # 사유 필드 기록
            "reason": "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
            # 처리 성공을 전체 파울 판정 성공으로 오인하지 않도록 작업 범위 기록
            "scope": "NOT_DECLARED_DECISION",
        }
        # 관측 구간 계수기에 1을 더해 누적
        self._episode_counter += 1
        # 관측 구간 반환
        return episode

    # 중복 식별자 거부와 지정 키 기반 관측 색인
    @staticmethod
    def uniqueIndex(items: tuple[Any, ...], attribute: str, reason: str) -> dict[int, Any]:
        # 키별 색인을 모를 빈 자료 생성
        indexed: dict[int, Any] = {}
        # 키와 값 목록에서 항목을 하나씩 읽음
        for item in items:
            # 식별자에 항목의 속성 또는 기본값 저장
            identifier = getattr(item, attribute)
            # 식별자 및 키별 색인의 포함 조건 확인
            if identifier in indexed:
                # 현재 오류를 호출자에게 전달
                raise ValueError(reason)
            # 키별 색인의 선택 항목에 항목 저장
            indexed[identifier] = item
        # 키별 색인 반환
        return indexed

    # 입력 조건 검사
    def inputValidation(
        self,
        frame: RecordedFrame,
        roles: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
    ) -> tuple[
        dict[int, Detection],
        dict[int, RoleHypothesis],
        dict[int, PoseObservation],
        Fraction,
        Fraction,
        tuple[Any, ...],
    ]:
        # 추적기 종료 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._finished:
            # 추적기 종료 여부 오류 알림
            raise ValueError("TRACKER_FINISHED")
        # 연속 구간 식별자의 자료 형식과 허용 조건 확인
        if type(frame.continuity_id) is not int or frame.continuity_id < 0:
            # 연속 구간 식별자 유효하지 않음 오류 알림
            raise ValueError("CONTINUITY_ID_INVALID")
        # 기록 순번의 자료 형식과 허용 조건 확인
        if type(frame.record_index) is not int or frame.record_index < 0:
            # 기록 순번 유효하지 않음 오류 알림
            raise ValueError("RECORD_INDEX_INVALID")

        # 표본에 프레임의 표본 저장
        sample = frame.sample
        # 계산한 시각에 표시 시각 기준 원본 밀리초 저장
        computed_timestamp = timestamp_from_pts(
            sample.pts,
            sample.time_base,
            sample.origin_pts,
            sample.origin_time_base,
        )
        # 프레임 시각 표시 시각 눈금 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if type(sample.timestamp_ms) is not int or sample.timestamp_ms != computed_timestamp:
            # 프레임 시각 표시 시각 눈금 불일치 오류 알림
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        # 원본 동일성 정보를 다음 항목으로 구성
        source_identity = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        # 원본 범위 변경을 감지해 잘못된 입력의 후속 사용 차단
        if self._source_identity is not None and source_identity != self._source_identity:
            # 원본 범위 변경 오류 알림
            raise ValueError("SOURCE_SCOPE_CHANGED")
        # 표시 시각 눈금 시간에 표본의 원본 표시 시각 눈금 및 표본의 눈금당 초 단위 시간의 곱 저장
        pts_time = sample.pts * sample.time_base
        # 원본 시작점 기준 경과 시간에 표시 시각 눈금 시간 및 시작점 표시 시각 눈금 및 시작점 눈금당 초 단위 시간의 곱의 차이 저장
        relative_time = pts_time - sample.origin_pts * sample.origin_time_base
        # 시간축 아닌 시간순을 감지해 잘못된 입력의 후속 사용 차단
        if self._previous_timestamp_ms is not None and (
            sample.timestamp_ms <= self._previous_timestamp_ms
            or pts_time <= self._previous_pts_time
        ):
            # 시간축 아닌 시간순 오류 알림
            raise ValueError("TIMELINE_NON_MONOTONIC")

        # 검출 목록의 자료 형식과 허용 조건 확인
        if not isinstance(frame.detections, tuple) or any(
            not isinstance(item, Detection) for item in frame.detections
        ):
            # 검출 목록 유효하지 않음 오류 알림
            raise ValueError("DETECTIONS_INVALID")
        # 역할 목록의 자료 형식과 허용 조건 확인
        if not isinstance(roles, tuple) or any(
            not isinstance(item, RoleHypothesis) for item in roles
        ):
            # 역할 목록 유효하지 않음 오류 알림
            raise ValueError("ROLES_INVALID")
        # 자세 목록의 자료 형식과 허용 조건 확인
        if not isinstance(poses, tuple) or any(
            not isinstance(item, PoseObservation) for item in poses
        ):
            # 자세 목록 유효하지 않음 오류 알림
            raise ValueError("POSES_INVALID")
        # 검출 목록에 중복 없는 순번 처리 결과 저장
        detections = self.uniqueIndex(frame.detections, "detection_id", "DUPLICATE_DETECTION_ID")
        # 역할 기준 식별자에 중복 없는 순번 처리 결과 저장
        role_by_id = self.uniqueIndex(roles, "detection_id", "DUPLICATE_ROLE_ID")
        # 자세 기준 식별자에 중복 없는 순번 처리 결과 저장
        pose_by_id = self.uniqueIndex(poses, "detection_id", "DUPLICATE_POSE_ID")
        # 연결된 역할 검출 식별자 목록에 빈 중복을 없앤 집합 저장
        matched_role_detection_ids: set[int] = set()
        # 역할 목록에서 역할을 하나씩 읽음
        for role in roles:
            # 역할의 상태 및 연결된의 불일치 조건 확인
            if role.status != "MATCHED":
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 중복 역할 검출 식별자를 감지해 잘못된 입력의 후속 사용 차단
            if role.role_detection_id in matched_role_detection_ids:
                # 중복 역할 검출 식별자 오류 알림
                raise ValueError("DUPLICATE_ROLE_DETECTION_ID")
            # 연결된 역할 검출 식별자 목록에 역할의 역할 검출 식별자를 중복 없이 추가
            matched_role_detection_ids.add(role.role_detection_id)
        # 추적 식별자 목록에 빈 중복을 없앤 집합 저장
        track_ids: set[str] = set()
        # 저장된 값 목록에서 검출을 하나씩 읽음
        for detection in detections.values():
            # 레이블 및 사람의 불일치 조건 또는 구간 안에서만 유효한 추적 식별자가 없는지 확인
            if detection.label != "person" or detection.track_id is None:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 중복 추적 식별자를 감지해 잘못된 입력의 후속 사용 차단
            if detection.track_id in track_ids:
                # 중복 추적 식별자 오류 알림
                raise ValueError("DUPLICATE_TRACK_ID")
            # 추적 식별자 목록에 검출의 구간 안에서만 유효한 추적 식별자를 중복 없이 추가
            track_ids.add(detection.track_id)

        # 역할 기준 식별자에서 검출 식별자를 하나씩 읽음
        for detection_id in role_by_id:
            # 대상 밖 역할 식별자를 감지해 잘못된 입력의 후속 사용 차단
            if detection_id not in detections:
                # 대상 밖 역할 식별자 오류 알림
                raise ValueError("FOREIGN_ROLE_ID")
            # 역할 사람 아님 대응 관계를 감지해 잘못된 입력의 후속 사용 차단
            if detections[detection_id].label != "person":
                # 역할 사람 아님 대응 관계 오류 알림
                raise ValueError("ROLE_NONPERSON_MAPPING")
        # 키와 값의 쌍 목록에서 검출 식별자·자세를 하나씩 읽음
        for detection_id, pose in pose_by_id.items():
            # 대상 밖 자세 식별자를 감지해 잘못된 입력의 후속 사용 차단
            if detection_id not in detections:
                # 대상 밖 자세 식별자 오류 알림
                raise ValueError("FOREIGN_POSE_ID")
            # 검출에 검출 목록의 선택 항목 저장
            detection = detections[detection_id]
            # 자세 사람 아님 대응 관계를 감지해 잘못된 입력의 후속 사용 차단
            if detection.label != "person":
                # 자세 사람 아님 대응 관계 오류 알림
                raise ValueError("POSE_NONPERSON_MAPPING")
            # 자세 원본 상자 불일치를 감지해 잘못된 입력의 후속 사용 차단
            if pose.source_box != detection.box:
                # 자세 원본 상자 불일치 오류 알림
                raise ValueError("POSE_SOURCE_BOX_MISMATCH")
        # 여러 값을 순서대로 모은 자료 반환
        return detections, role_by_id, pose_by_id, pts_time, relative_time, source_identity

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        frame: RecordedFrame,
        roles: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
    ) -> tuple[dict[str, Any], ...]:
        # 여러 값을 순서대로 모은 자료에 입력 입력 검사 처리 결과 저장
        (
            detections,
            role_by_id,
            pose_by_id,
            pts_time,
            relative_time,
            source_identity,
        ) = self.inputValidation(frame, roles, poses)
        # 프레임 기록에 저장용 관측 기록 저장
        frame_record = frame.sample.as_record()
        # 너비·높이를 다음 항목으로 구성
        width, height = frame_record["width"], frame_record["height"]
        # 원본 시작점 기준 밀리초에 프레임의 표본의 원본 시작점 기준 밀리초 저장
        timestamp_ms = frame.sample.timestamp_ms
        # 관측된에 빈 중복을 없앤 집합 저장
        observed: set[tuple[int, str, str]] = set()
        # 마감된 관측을 모를 빈 자료 생성
        emitted: list[dict[str, Any]] = []

        # 키와 값의 쌍 목록에서 검출 식별자·검출을 하나씩 읽음
        for detection_id, detection in detections.items():
            # 역할에 검출 식별자의 키에 해당하는 값 저장
            role = role_by_id.get(detection_id)
            # 자세에 검출 식별자의 키에 해당하는 값 저장
            pose = pose_by_id.get(detection_id)
            # 레이블 및 사람의 불일치 조건 또는 구간 안에서만 유효한 추적 식별자가 없는지 또는 역할이 없는지 확인
            if (
                detection.label != "person"
                or detection.track_id is None
                or role is None
                or role.status != "MATCHED"
                or role.role != "referee"
                or role.score is None
                or role.score < 0.50
                or pose is None
                or pose.source_box != detection.box
            ):
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 판정 의미를 부여하지 않은 양팔 기하 관측에서 팔을 하나씩 읽음
            for arm in armObservations(pose, width, height):
                # 팔의 상태 및 팔 팔 올림 조건 충족의 불일치 조건 확인
                if arm["state"] != "ARM_RAISED":
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 키를 다음 항목으로 구성
                key = (frame.continuity_id, detection.track_id, arm["side"])
                # 관측된에 키를 중복 없이 추가
                observed.add(key)
                # 현재에 키의 키에 해당하는 값 저장
                current = self._active.get(key)
                # 사분의 일 초보다 큰 관측 공백이면 이전 팔 동작과 새 동작을 분리
                if current is not None and relative_time - current.last_time > Fraction(1, 4):
                    # 관측 구간에 구간 마감 처리 결과 저장
                    episode = self.closure(key)
                    # 관측 구간이 있는지 확인
                    if episode is not None:
                        # 마감된 관측에 관측 구간 추가
                        emitted.append(episode)
                    # 현재를 아직 없는 상태로 초기화
                    current = None
                # 현재가 없는지 확인
                if current is None:
                    # 활성의 선택 항목에 연속 관측 처리 결과 저장
                    self._active[key] = _Run(
                        continuity_id=frame.continuity_id,
                        track_id=detection.track_id,
                        side=arm["side"],
                        start_ms=timestamp_ms,
                        last_ms=timestamp_ms,
                        start_time=relative_time,
                        last_time=relative_time,
                        support_count=1,
                        start_frame=frame_record,
                        last_frame=frame_record,
                    )
                # 앞선 분기에 해당하지 않는 경우 처리
                else:
                    # 연속 관측 연장에 필요한 입력을 전달해 처리
                    current.extension(timestamp_ms, relative_time, frame_record)

        # 활성의 순서를 고정한 튜플 변환 결과에서 키를 하나씩 읽음
        for key in tuple(self._active):
            # 키 및 관측된의 미포함 조건 확인
            if key not in observed:
                # 관측 구간에 구간 마감 처리 결과 저장
                episode = self.closure(key)
                # 관측 구간이 있는지 확인
                if episode is not None:
                    # 마감된 관측에 관측 구간 추가
                    emitted.append(episode)
        # 이전 시각 밀리초에 원본 시작점 기준 밀리초 저장
        self._previous_timestamp_ms = timestamp_ms
        # 이전 표시 시각 눈금 시간에 표시 시각 눈금 시간 저장
        self._previous_pts_time = pts_time
        # 원본 동일성 정보에 원본 동일성 정보 저장
        self._source_identity = source_identity
        # 마감된 관측의 순서를 고정한 튜플 변환 결과 반환
        return tuple(emitted)

    # 남은 연속 관측을 마감하고 최종 결과를 반환
    def finish(self) -> tuple[dict[str, Any], ...]:
        # 종료 여부 확인
        if self._finished:
            # 빈 튜플 반환
            return ()
        # 마감된 관측을 모를 빈 자료 생성
        emitted: list[dict[str, Any]] = []
        # 활성의 순서를 고정한 튜플 변환 결과에서 키를 하나씩 읽음
        for key in tuple(self._active):
            # 관측 구간에 구간 마감 처리 결과 저장
            episode = self.closure(key)
            # 관측 구간이 있는지 확인
            if episode is not None:
                # 마감된 관측에 관측 구간 추가
                emitted.append(episode)
        # 종료 여부를 참 값으로 설정
        self._finished = True
        # 마감된 관측의 순서를 고정한 튜플 변환 결과 반환
        return tuple(emitted)
