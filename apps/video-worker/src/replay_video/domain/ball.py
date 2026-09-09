from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BallCandidate:
    # 작은 밝은 원형 물체 후보이며 축구공임이 검증된 위치가 아니다
    x: float
    y: float
    radius: float
    circularity: float


@dataclass(frozen=True, slots=True)
class BallMotion:
    status: str
    track_id: int | None
    candidate: BallCandidate | None
    compensated_displacement_px: float | None
    stationary_ms: int
    motion_onset_ms: int | None
    reason: str | None


class BallTracker:
    """카메라 변환으로 보정한 후보 이동을 추적하며 경기 중단이나 킥을 판정하지 않는다"""

    def __init__(self) -> None:
        self.last_time: int | None = None
        self.continuity: int | None = None
        self.size: tuple[int, int] | None = None
        self.serial = 0
        self._clear()

    def _clear(self) -> None:
        # 가림 뒤 다른 물체로 정지 이력이 전이되지 않도록 즉시 초기화한다
        self.point: BallCandidate | None = None
        self.anchor: tuple[float, float] | None = None
        self.rest_since: int | None = None
        self.armed = False
        self.moving_since: int | None = None
        self.moving_count = 0

    def _unknown(self, reason: str) -> BallMotion:
        self._clear()
        return BallMotion("UNKNOWN", None, None, None, 0, None, reason)

    def update(
        self,
        timestamp_ms: int,
        continuity_id: int,
        width: int,
        height: int,
        candidates: tuple[BallCandidate, ...],
        camera_affine: tuple[float, ...] | None,
    ) -> BallMotion:
        if type(timestamp_ms) is not int or timestamp_ms < 0 or (self.last_time is not None and timestamp_ms <= self.last_time):
            raise ValueError("ball-time-not-increasing")
        if width < 16 or height < 16:
            raise ValueError("invalid-ball-image-size")
        for item in candidates:
            if not all(math.isfinite(value) for value in (item.x, item.y, item.radius, item.circularity)) or not (
                0 <= item.x < width and 0 <= item.y < height and item.radius > 0 and 0 <= item.circularity <= 1
            ):
                raise ValueError("invalid-ball-candidate")
        gap = timestamp_ms - self.last_time if self.last_time is not None else None
        boundary = self.continuity != continuity_id or self.size != (width, height) or (gap is not None and gap > 500)
        self.last_time = timestamp_ms
        self.continuity = continuity_id
        self.size = (width, height)
        if boundary:
            self._clear()
        if not candidates:
            return self._unknown("NO_BALL_CANDIDATE")
        if self.point is None:
            if len(candidates) != 1:
                return self._unknown("AMBIGUOUS_BALL_CANDIDATES")
            self.serial += 1
            self.point = candidates[0]
            self.anchor = (self.point.x, self.point.y)
            self.rest_since = timestamp_ms
            return BallMotion("ACQUIRING", self.serial, self.point, None, 0, None, None)

        # 평행 이동뿐 아니라 확대와 회전을 포함한 전체 변환을 사용한다
        if camera_affine is None or len(camera_affine) != 6 or not all(math.isfinite(value) for value in camera_affine):
            return self._unknown("CAMERA_TRANSFORM_UNAVAILABLE")
        a, b, tx, c, d, ty = camera_affine
        transform = lambda x, y: (a * x + b * y + tx, c * x + d * y + ty)
        predicted = transform(self.point.x, self.point.y)
        eligible = [item for item in candidates if math.dist((item.x, item.y), predicted) <= width * 0.08]
        if not eligible:
            return self._unknown("TRACK_DISCONTINUITY")
        if len(eligible) != 1:
            return self._unknown("AMBIGUOUS_BALL_CANDIDATES")
        point = eligible[0]
        scale = math.sqrt(abs(a * d - b * c))
        if not 0.5 <= point.radius / max(0.01, self.point.radius * scale) <= 2:
            return self._unknown("BALL_SIZE_DISCONTINUITY")
        displacement = math.dist((point.x, point.y), predicted)
        assert self.anchor is not None and self.rest_since is not None and gap is not None
        self.anchor = transform(*self.anchor)
        self.point = point
        still = math.dist((point.x, point.y), self.anchor) <= width * 0.003
        onset = None
        stationary_ms = 0
        if still:
            stationary_ms = timestamp_ms - self.rest_since
            self.armed = stationary_ms >= 600
            self.moving_since = None
            self.moving_count = 0
            status = "STATIONARY" if self.armed else "ACQUIRING"
        else:
            # 두 연속 샘플의 움직임을 보고 첫 움직임 시각을 반환한다
            moving = displacement / (gap / 1000) >= width * 0.015
            if self.armed and moving:
                if self.moving_count == 0:
                    self.moving_since = timestamp_ms
                self.moving_count += 1
                if self.moving_count >= 2:
                    onset = self.moving_since
                    self.armed = False
            else:
                self.armed = False
                self.moving_count = 0
                self.moving_since = None
            status = "MOVING"
            if not self.armed:
                self.anchor = (point.x, point.y)
                self.rest_since = timestamp_ms
        return BallMotion(status, self.serial, point, round(displacement, 4), stationary_ms, onset, None)
