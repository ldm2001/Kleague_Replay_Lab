# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 거리 계산과 수치 유효성 확인 도구 가져옴
import math
# 관측 필드 자료형 선언 도구 가져옴
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
# 밝은 원형 후보의 화면 좌표 자료형 선언
class BallCandidate:
    # 작은 밝은 원형 물체 후보이며 축구공임이 검증된 위치가 아님
    x: float
    # 영상 위쪽 기준 세로 픽셀 좌표 보관
    y: float
    # 후보 원의 픽셀 반지름 보관
    radius: float
    # 원에 가까운 정도를 나타내는 비율 보관
    circularity: float


@dataclass(frozen=True, slots=True)
# 공 후보 움직임 측정 결과 자료형 선언
class BallMotion:
    # 정지 또는 이동 등 추적 상태 보관
    status: str
    # 같은 후보를 연결하는 추적 번호 보관
    track_id: int | None
    # 현재 화면의 후보 위치 보관
    candidate: BallCandidate | None
    # 카메라 변환을 뺀 픽셀 이동량 보관
    compensated_displacement_px: float | None
    # 후보의 정지 지속 밀리초 보관
    stationary_ms: int
    # 정지 뒤 움직임이 시작된 원본 시각 보관
    motion_onset_ms: int | None
    # 추적을 확정하지 못한 사유 보관
    reason: str | None


# 후보 좌표의 정지와 이동 이력 관리
class BallTracker:
    """카메라 보정 후보 이동 추적과 경기 중단·킥 판정 제외"""

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 이전 표본 시각의 초기 빈 값 생성
        self.last_time: int | None = None
        # 이전 연속 영상 구간 번호의 초기 빈 값 생성
        self.continuity: int | None = None
        # 이전 영상 크기의 초기 빈 값 생성
        self.size: tuple[int, int] | None = None
        # 새 추적 번호의 시작값 설정
        self.serial = 0
        # 위치와 정지 이력의 초기 상태 생성
        self.reset()

    # 이전 연속 구간의 추적 이력을 초기화
    def reset(self) -> None:
        # 가림 뒤 다른 물체로 정지 이력이 전이되지 않도록 즉시 초기화
        self.point: BallCandidate | None = None
        # 카메라 변환을 따라 이동할 정지 기준점 초기화
        self.anchor: tuple[float, float] | None = None
        # 정지 시작 시각 초기화
        self.rest_since: int | None = None
        # 충분한 정지 관측 여부 초기화
        self.armed = False
        # 연속 움직임 시작 시각 초기화
        self.moving_since: int | None = None
        # 연속 움직임 표본 수 초기화
        self.moving_count = 0

    # 측정할 수 없는 이유를 미확인 상태와 함께 반환
    def unknown(self, reason: str) -> BallMotion:
        # 미확인 상태로 전환하기 전 과거 위치 이력 초기화
        self.reset()
        # 위치를 확정하지 않은 결과와 사유 반환
        return BallMotion("UNKNOWN", None, None, None, 0, None, reason)

    # 카메라 보정 좌표를 누적해 공 후보의 정지 후 움직임을 측정
    def update(
        self,
        timestamp_ms: int,
        continuity_id: int,
        width: int,
        height: int,
        candidates: tuple[BallCandidate, ...],
        camera_affine: tuple[float, ...] | None,
    ) -> BallMotion:
        # 원본 시각의 정수 여부와 증가 순서 확인
        if (
            type(timestamp_ms) is not int
            or timestamp_ms < 0
            or (self.last_time is not None and timestamp_ms <= self.last_time)
        ):
            # 중복되거나 역행하는 시각 오류 전달
            raise ValueError("ball-time-not-increasing")
        # 최소 영상 크기 충족 여부 확인
        if width < 16 or height < 16:
            # 추적 불가능한 영상 크기 오류 전달
            raise ValueError("invalid-ball-image-size")
        # 각 원형 후보를 순서대로 확인
        for item in candidates:
            # 유한한 좌표와 영상 경계와 후보 크기 범위 확인
            if not all(
                math.isfinite(value) for value in (item.x, item.y, item.radius, item.circularity)
            ) or not (
                0 <= item.x < width
                and 0 <= item.y < height
                and item.radius > 0
                and 0 <= item.circularity <= 1
            ):
                # 유효하지 않은 후보 값 오류 전달
                raise ValueError("invalid-ball-candidate")
        # 직전 표본과 현재 표본의 밀리초 간격 계산
        gap = timestamp_ms - self.last_time if self.last_time is not None else None
        # 화면 구간 또는 크기 변경과 긴 표본 공백 확인
        boundary = (
            self.continuity != continuity_id
            or self.size != (width, height)
            or (gap is not None and gap > 500)
        )
        # 다음 비교를 위한 현재 시각 저장
        self.last_time = timestamp_ms
        # 다음 비교를 위한 현재 연속 구간 저장
        self.continuity = continuity_id
        # 다음 비교를 위한 현재 영상 크기 저장
        self.size = (width, height)
        # 이전 이력을 이어갈 수 없는 경계 확인
        if boundary:
            # 경계 이전 후보 위치와 정지 이력 초기화
            self.reset()
        # 현재 화면에 후보가 없는지 확인
        if not candidates:
            # 후보 부재를 추적 미확인으로 반환
            return self.unknown("NO_BALL_CANDIDATE")
        # 연결할 이전 후보 위치의 부재 확인
        if self.point is None:
            # 첫 위치를 하나로 선택할 수 있는지 확인
            if len(candidates) != 1:
                # 첫 후보가 여러 개인 모호성 반환
                return self.unknown("AMBIGUOUS_BALL_CANDIDATES")
            # 새 후보 추적 번호 증가
            self.serial += 1
            # 유일한 후보를 현재 위치로 저장
            self.point = candidates[0]
            # 첫 후보 좌표를 정지 기준점으로 설정
            self.anchor = (self.point.x, self.point.y)
            # 정지 지속 시간의 시작 시각 저장
            self.rest_since = timestamp_ms
            # 정지 여부를 아직 모으는 초기 추적 결과 반환
            return BallMotion("ACQUIRING", self.serial, self.point, None, 0, None, None)

        # 이동·확대·회전을 포함한 전체 변환 사용
        if (
            camera_affine is None
            or len(camera_affine) != 6
            or not all(math.isfinite(value) for value in camera_affine)
        ):
            # 카메라 보정 불가능 사유를 미확인으로 반환
            return self.unknown("CAMERA_TRANSFORM_UNAVAILABLE")
        # 가로와 세로 변환 계수 및 이동량 분리
        a, b, tx, c, d, ty = camera_affine
        # 영상 좌표에 아핀 변환을 적용하는 계산식 생성
        transform = lambda x, y: (a * x + b * y + tx, c * x + d * y + ty)
        # 이전 후보가 현재 화면에서 나타날 예상 위치 계산
        predicted = transform(self.point.x, self.point.y)
        # 예상 위치와 화면 너비의 8퍼센트 이내인 후보 선택
        eligible = [
            item for item in candidates if math.dist((item.x, item.y), predicted) <= width * 0.08
        ]
        # 예상 위치 근처 후보의 부재 확인
        if not eligible:
            # 경로가 끊어진 사유를 미확인으로 반환
            return self.unknown("TRACK_DISCONTINUITY")
        # 연결할 후보의 유일성 확인
        if len(eligible) != 1:
            # 여러 후보가 가능한 모호성 반환
            return self.unknown("AMBIGUOUS_BALL_CANDIDATES")
        # 유일하게 연결 가능한 후보 선택
        point = eligible[0]
        # 카메라 변환의 면적 변화로 길이 배율 계산
        scale = math.sqrt(abs(a * d - b * c))
        # 확대 보정 뒤 후보 반지름의 급변 여부 확인
        if not 0.5 <= point.radius / max(0.01, self.point.radius * scale) <= 2:
            # 크기 변화로 후보 연결 불가 사유 반환
            return self.unknown("BALL_SIZE_DISCONTINUITY")
        # 카메라 보정 예상점과 실제 후보 사이 픽셀 거리 계산
        displacement = math.dist((point.x, point.y), predicted)
        # 기존 추적의 기준점과 시각 및 표본 간격 존재 확인
        assert self.anchor is not None and self.rest_since is not None and gap is not None
        # 정지 기준점에도 동일한 카메라 변환 적용
        self.anchor = transform(*self.anchor)
        # 새 후보 위치로 이전 위치 갱신
        self.point = point
        # 기준점과의 거리가 화면 너비의 0점3퍼센트 이내인지 확인
        still = math.dist((point.x, point.y), self.anchor) <= width * 0.003
        # 이번 표본의 움직임 시작 시각을 빈 값으로 초기화
        onset = None
        # 이번 표본의 정지 지속 시간을 영으로 초기화
        stationary_ms = 0
        # 후보가 기준점 근처에 머무는지 확인
        if still:
            # 기준점 설정 뒤 지난 정지 시간 계산
            stationary_ms = timestamp_ms - self.rest_since
            # 600밀리초 이상 정지 관측 여부 저장
            self.armed = stationary_ms >= 600
            # 이동 시작 시각의 과거 이력 초기화
            self.moving_since = None
            # 연속 이동 횟수 초기화
            self.moving_count = 0
            # 정지 충분 여부에 따른 상태 선택
            status = "STATIONARY" if self.armed else "ACQUIRING"
        # 정지 기준점에서 벗어난 후보의 움직임 확인
        else:
            # 두 연속 샘플의 움직임을 보고 첫 움직임 시각을 반환
            moving = displacement / (gap / 1000) >= width * 0.015
            # 충분한 정지 뒤 유효한 이동이 있는지 확인
            if self.armed and moving:
                # 연속 이동의 첫 표본 여부 확인
                if self.moving_count == 0:
                    # 첫 이동의 원본 시각 저장
                    self.moving_since = timestamp_ms
                # 연속 이동 표본 수 증가
                self.moving_count += 1
                # 두 표본 이상 움직임이 이어졌는지 확인
                if self.moving_count >= 2:
                    # 첫 표본 시각을 움직임 시작으로 선택
                    onset = self.moving_since
                    # 같은 정지 이력의 움직임 중복 검출 방지
                    self.armed = False
            # 충분한 정지 뒤 연속 이동 조건을 충족하지 못한 경우 분기
            else:
                # 정지 뒤 이동 대기 상태 해제
                self.armed = False
                # 연속 이동 횟수 초기화
                self.moving_count = 0
                # 이동 시작 시각 초기화
                self.moving_since = None
            # 후보가 움직이는 상태 저장
            status = "MOVING"
            # 기존 정지 기준을 새로 잡을 시점 확인
            if not self.armed:
                # 현재 후보 위치를 새 정지 기준으로 저장
                self.anchor = (point.x, point.y)
                # 새로운 정지 시간 계산의 기준 시각 저장
                self.rest_since = timestamp_ms
        # 픽셀 움직임 결과 반환과 실제 킥 또는 접촉 해석 제외
        return BallMotion(
            status, self.serial, point, round(displacement, 4), stationary_ms, onset, None
        )
