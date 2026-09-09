from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True, slots=True)
class FrameContext:
    # 좌표는 아래 분석 해상도 기준이며 실제 경기장 미터 좌표가 아니다
    width: int
    height: int
    grass_ratio: float
    line_segments: tuple[tuple[int, int, int, int], ...]
    camera_dx: float | None
    camera_dy: float | None
    residual_motion: float | None
    inlier_ratio: float | None
    quality_reason: str | None
    camera_affine: tuple[float, ...] | None = None


def _image(frame: np.ndarray) -> np.ndarray:
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8 or min(frame.shape[:2]) < 16:
        raise ValueError("invalid-context-frame")
    height, width = frame.shape[:2]
    if width <= 640:
        return frame
    return cv2.resize(frame, (640, max(16, round(height * 640 / width))), interpolation=cv2.INTER_AREA)


def _field(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    # 색상 범위는 기준선이며 조명과 유니폼 때문에 경기장 의미를 보장하지 않는다
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    grass = cv2.inRange(hsv, (30, 40, 35), (95, 255, 255))
    white = cv2.inRange(hsv, (0, 0, 160), (179, 65, 255))
    near_grass = cv2.dilate(grass, np.ones((9, 9), dtype=np.uint8))
    return grass, cv2.bitwise_and(white, near_grass)


def frame_context(frame: np.ndarray, previous: np.ndarray | None = None) -> FrameContext:
    """잔디색과 선분 및 전역 영상 이동을 측정하며 공과 선수로 분류하지 않는다"""
    image = _image(frame)
    grass, white = _field(image)
    height, width = image.shape[:2]
    lines = cv2.HoughLinesP(white, 1, np.pi / 180, threshold=25, minLineLength=max(20, width // 8), maxLineGap=8)
    segments = tuple(tuple(int(value) for value in line[0]) for line in lines[:32]) if lines is not None else ()
    values: dict[str, Any] = {
        "width": width, "height": height,
        "grass_ratio": round(float(np.count_nonzero(grass) / grass.size), 6),
        "line_segments": segments, "camera_dx": None, "camera_dy": None,
        "residual_motion": None, "inlier_ratio": None, "quality_reason": None,
    }
    if previous is None:
        return FrameContext(**{**values, "quality_reason": "NO_PREVIOUS_FRAME"})
    before = _image(previous)
    if before.shape != image.shape:
        return FrameContext(**{**values, "quality_reason": "FRAME_SIZE_CHANGED"})
    previous_grass, _ = _field(before)
    if values["grass_ratio"] < 0.2 or np.count_nonzero(previous_grass) / previous_grass.size < 0.2:
        return FrameContext(**{**values, "quality_reason": "LOW_GRASS_COVERAGE"})

    # 화면 전체를 함께 움직이는 특징점을 찾아 카메라 이동 성분을 근사한다
    old_gray = cv2.cvtColor(before, cv2.COLOR_BGR2GRAY)
    new_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    points = cv2.goodFeaturesToTrack(old_gray, maxCorners=250, qualityLevel=0.01, minDistance=7, mask=previous_grass)
    if points is None or len(points) < 12:
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_FEATURES"})
    moved, status, _ = cv2.calcOpticalFlowPyrLK(old_gray, new_gray, points, None)
    if moved is None or status is None:
        return FrameContext(**{**values, "quality_reason": "TRACKING_FAILED"})
    valid = (status.reshape(-1) == 1) & np.isfinite(moved.reshape(-1, 2)).all(axis=1)
    old_points = points.reshape(-1, 2)[valid]
    new_points = moved.reshape(-1, 2)[valid]
    if len(old_points) < 12:
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_TRACKS"})
    matrix, inliers = cv2.estimateAffinePartial2D(old_points, new_points, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if matrix is None or inliers is None or not np.isfinite(matrix).all():
        return FrameContext(**{**values, "quality_reason": "REGISTRATION_FAILED"})
    ratio = float(inliers.mean())
    scale = float(np.hypot(matrix[0, 0], matrix[0, 1]))
    if ratio < 0.65 or not 0.8 <= scale <= 1.25:
        return FrameContext(**{**values, "inlier_ratio": round(ratio, 6), "quality_reason": "UNRELIABLE_REGISTRATION"})

    # 워핑으로 생긴 테두리는 잔차 계산에서 제외한다
    aligned = cv2.warpAffine(old_gray, matrix, (width, height))
    coverage = cv2.warpAffine(np.full_like(old_gray, 255), matrix, (width, height)) == 255
    if float(coverage.mean()) < 0.5:
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_OVERLAP"})
    residual = float(cv2.absdiff(aligned, new_gray)[coverage].mean() / 255.0)
    return FrameContext(**{
        **values, "camera_dx": round(float(matrix[0, 2]), 4),
        "camera_dy": round(float(matrix[1, 2]), 4),
        "residual_motion": round(residual, 6), "inlier_ratio": round(ratio, 6),
        "camera_affine": tuple(float(value) for value in matrix.reshape(-1)),
    })
