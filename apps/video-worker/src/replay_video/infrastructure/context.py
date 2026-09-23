from __future__ import annotations
from dataclasses import dataclass
from typing import Any
import cv2
import numpy as np


@dataclass(frozen=True, slots=True)
class FrameContext:
    # 좌표는 아래 분석 해상도 기준이며 실제 경기장 미터 좌표가 아님
    width: int
    # 분석 화면의 세로 픽셀 수 보존
    height: int
    # 분석 화면에서 잔디색 마스크가 차지하는 비율 보존
    grass_ratio: float
    # 잔디 주변에서 검출한 흰색 선분 양 끝 좌표 보존
    line_segments: tuple[tuple[int, int, int, int], ...]
    # 화면 정합으로 근사한 가로 전역 이동량 보존
    camera_dx: float | None
    # 화면 정합으로 근사한 세로 전역 이동량 보존
    camera_dy: float | None
    # 전역 이동 보정 후 남은 픽셀 차이 크기 보존
    residual_motion: float | None
    # 추정 화면 변환에 일치하는 특징점 비율 보존
    inlier_ratio: float | None
    # 화면 이동을 측정하지 못한 품질 제한 사유 보존
    quality_reason: str | None
    # 분석 화면 사이의 평행이동·회전·크기 변환 계수 보존
    camera_affine: tuple[float, ...] | None = None

# 분석에 사용할 영상 크기와 픽셀 형식을 정규화
def frameImage(frame: np.ndarray) -> np.ndarray:
    # 세 채널 바이트 이미지와 최소 화면 크기를 만족하는지 확인
    if (
        frame.ndim != 3
        or frame.shape[2] != 3
        or frame.dtype != np.uint8
        or min(frame.shape[:2]) < 16
    ):
        # 세 채널 바이트 영상 또는 최소 크기를 갖추지 못한 입력 거부
        raise ValueError("invalid-context-frame")
    # 입력 화면의 높이와 너비 읽음
    height, width = frame.shape[:2]
    # 이미 분석 최대 너비 안에 있는 화면인지 확인
    if width <= 640:
        # 작은 입력 화면은 재확대 없이 그대로 반환
        return frame
    # 종횡비를 유지하면서 최대 분석 너비로 축소한 화면 반환
    return cv2.resize(
        frame, (640, max(16, round(height * 640 / width))), interpolation=cv2.INTER_AREA
    )

# 잔디색과 연결 영역을 이용해 경기장 탐색 마스크를 생성
def field(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    # 색상 범위는 기준선이며 조명과 유니폼 때문에 경기장 의미를 보장 불가
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 잔디색에 가까운 색상·채도·명도 픽셀 추출
    grass = cv2.inRange(hsv, (30, 40, 35), (95, 255, 255))
    # 경기장 선 후보가 될 밝고 낮은 채도의 픽셀 추출
    white = cv2.inRange(hsv, (0, 0, 160), (179, 65, 255))
    # 잔디 주변 흰 선을 포함하도록 잔디 마스크 확장
    near_grass = cv2.dilate(grass, np.ones((9, 9), dtype=np.uint8))
    # 잔디색 영역과 그 주변의 흰색 영역을 별도로 반환
    return grass, cv2.bitwise_and(white, near_grass)

# 화면의 잔디·선·카메라 움직임과 잔여 변화량을 측정
def frameContext(frame: np.ndarray, previous: np.ndarray | None = None) -> FrameContext:
    """잔디색·선분·전역 영상 이동 측정과 공·선수 분류 제외"""
    # 현재 원본 화면을 고정 분석 해상도로 정규화
    image = frameImage(frame)
    # 현재 화면의 잔디색과 인접 흰색 마스크 생성
    grass, white = field(image)
    # 정규화된 분석 좌표계의 화면 크기 읽음
    height, width = image.shape[:2]
    # 흰색 마스크에서 길이와 틈 기준을 만족하는 선분 탐색
    lines = cv2.HoughLinesP(
        white, 1, np.pi / 180, threshold=25, minLineLength=max(20, width // 8), maxLineGap=8
    )
    # 검출한 선분을 최대 서른두 개의 정수 좌표로 보존
    segments = (
        tuple(tuple(int(value) for value in line[0]) for line in lines[:32])
        if lines is not None
        else ()
    )
    # 정적 화면 근거를 기록하고 시간 비교 측정은 미확인으로 초기화
    values: dict[str, Any] = {
        "width": width,
        "height": height,
        "grass_ratio": round(float(np.count_nonzero(grass) / grass.size), 6),
        "line_segments": segments,
        "camera_dx": None,
        "camera_dy": None,
        "residual_motion": None,
        "inlier_ratio": None,
        "quality_reason": None,
    }
    # 비교할 이전 화면이 제공되었는지 확인
    if previous is None:
        # 이전 화면 누락 사유와 정적 화면 관측만 반환
        return FrameContext(**{**values, "quality_reason": "NO_PREVIOUS_FRAME"})
    # 이전 화면도 같은 분석 해상도 규칙으로 정규화
    before = frameImage(previous)
    # 두 화면의 좌표계 크기가 달라 비교할 수 없는지 확인
    if before.shape != image.shape:
        # 해상도 변경 사유를 남기고 시간 비교 측정 생략
        return FrameContext(**{**values, "quality_reason": "FRAME_SIZE_CHANGED"})
    # 이전 화면의 잔디 특징점 탐색 영역 생성
    previous_grass, _ = field(before)
    # 현재 또는 이전 화면의 잔디색 범위가 충분한지 확인
    if values["grass_ratio"] < 0.2 or np.count_nonzero(previous_grass) / previous_grass.size < 0.2:
        # 잔디 근거 부족을 정지 상태가 아닌 측정 제한으로 반환
        return FrameContext(**{**values, "quality_reason": "LOW_GRASS_COVERAGE"})

    # 화면 전체를 함께 움직이는 특징점을 찾아 카메라 이동 성분을 근사
    old_gray = cv2.cvtColor(before, cv2.COLOR_BGR2GRAY)
    # 현재 화면을 특징점 추적용 회색조로 변환
    new_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # 이전 잔디 영역에서 안정적으로 추적할 밝기 특징점 탐색
    points = cv2.goodFeaturesToTrack(
        old_gray, maxCorners=250, qualityLevel=0.01, minDistance=7, mask=previous_grass
    )
    # 카메라 정합에 필요한 최소 특징점 수 확인
    if points is None or len(points) < 12:
        # 특징점 부족 사유와 정적 관측 반환
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_FEATURES"})
    # 이전 특징점의 현재 화면 위치를 광류로 추적
    moved, status, _ = cv2.calcOpticalFlowPyrLK(old_gray, new_gray, points, None)
    # 특징점 추적 좌표와 상태의 생성 여부 확인
    if moved is None or status is None:
        # 화면 특징점 추적 실패를 품질 제한으로 반환
        return FrameContext(**{**values, "quality_reason": "TRACKING_FAILED"})
    # 추적에 성공하고 유한 좌표를 가진 특징점만 선택
    valid = (status.reshape(-1) == 1) & np.isfinite(moved.reshape(-1, 2)).all(axis=1)
    # 유효하게 연결된 특징점의 이전 좌표 추출
    old_points = points.reshape(-1, 2)[valid]
    # 같은 특징점의 현재 좌표 추출
    new_points = moved.reshape(-1, 2)[valid]
    # 추적 성공 후에도 정합용 특징점 수가 충분한지 확인
    if len(old_points) < 12:
        # 유효 추적점 부족을 전역 이동 없음과 구별해 반환
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_TRACKS"})
    # 이상점을 제외하며 전역 평행이동·회전·크기 변환 추정
    matrix, inliers = cv2.estimateAffinePartial2D(
        old_points, new_points, method=cv2.RANSAC, ransacReprojThreshold=2.0
    )
    # 유효한 화면 변환 행렬과 일치점 판정이 생성되었는지 확인
    if matrix is None or inliers is None or not np.isfinite(matrix).all():
        # 전역 화면 정합 실패 사유 반환
        return FrameContext(**{**values, "quality_reason": "REGISTRATION_FAILED"})
    # 추정 변환에 일치하는 추적점 비율 계산
    ratio = float(inliers.mean())
    # 변환 행렬에서 화면 크기 변화 배율 계산
    scale = float(np.hypot(matrix[0, 0], matrix[0, 1]))
    # 일치점 비율과 확대·축소 배율이 신뢰 범위 안인지 확인
    if ratio < 0.65 or not 0.8 <= scale <= 1.25:
        # 화면 관측값과 정합 품질 또는 보정 측정 결과 반환
        return FrameContext(
            **{
                **values,
                "inlier_ratio": round(ratio, 6),
                "quality_reason": "UNRELIABLE_REGISTRATION",
            }
        )

    # 워핑으로 생긴 테두리는 잔차 계산에서 제외
    aligned = cv2.warpAffine(old_gray, matrix, (width, height))
    # 이전 화면이 실제로 덮는 정합 후 유효 영역 계산
    coverage = cv2.warpAffine(np.full_like(old_gray, 255), matrix, (width, height)) == 255
    # 두 화면이 겹치는 유효 면적이 충분한지 확인
    if float(coverage.mean()) < 0.5:
        # 화면 중첩 부족을 움직임 측정 제한 사유로 반환
        return FrameContext(**{**values, "quality_reason": "INSUFFICIENT_OVERLAP"})
    # 유효 겹침 영역에서 전역 보정 후 남은 픽셀 차이 평균 계산
    residual = float(cv2.absdiff(aligned, new_gray)[coverage].mean() / 255.0)
    # 화면 관측값과 정합 품질 또는 보정 측정 결과 반환
    return FrameContext(
        **{
            **values,
            "camera_dx": round(float(matrix[0, 2]), 4),
            "camera_dy": round(float(matrix[1, 2]), 4),
            "residual_motion": round(residual, 6),
            "inlier_ratio": round(ratio, 6),
            "camera_affine": tuple(float(value) for value in matrix.reshape(-1)),
        }
    )
