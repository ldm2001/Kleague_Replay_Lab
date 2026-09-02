from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from ..domain.models import VideoMetadata


@dataclass(frozen=True, slots=True)
class Signal:
    # 영상 변화 신호
    frame_index: int
    timestamp_ms: int
    score: float


# 색상 히스토그램 계산
def histogram(frame: np.ndarray) -> np.ndarray:
    # 색상 공간 변환
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 색상 히스토그램 생성
    histogram = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
    # 히스토그램 정규화
    return cv2.normalize(histogram, histogram).flatten()


# 영상 변화 수집
@lru_cache(maxsize=8)
def signals(source: Path | str, metadata: VideoMetadata, sample_fps: float = 2.0) -> tuple[Signal, ...]:
    # 영상 캡처 열기
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("video-open-failed")

    # 샘플 간격 계산
    stride = max(1, round(metadata.fps / max(sample_fps, 1.0)))
    # 신호 결과 초기화
    result: list[Signal] = []
    # 이전 히스토그램 초기화
    previous_histogram: np.ndarray | None = None
    # 이전 프레임 초기화
    previous_frame: np.ndarray | None = None
    # 프레임 인덱스 초기화
    frame_index = 0
    try:
        while True:
            # 다음 프레임 확보
            if not capture.grab():
                break
            if frame_index % stride != 0:
                # 샘플 외 프레임 건너뛰기
                frame_index += 1
                continue

            # 샘플 프레임 변환
            ok, frame = capture.retrieve()
            if not ok:
                break

            # 분석용 크기 축소
            small = cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA)
            # 현재 히스토그램 계산
            current = histogram(small)
            if previous_histogram is not None and previous_frame is not None:
                # 픽셀 움직임 계산
                motion = float(cv2.absdiff(previous_frame, small).mean() / 255.0)
                # 히스토그램 차이 계산
                histogram_distance = float(cv2.compareHist(previous_histogram, current, cv2.HISTCMP_BHATTACHARYYA))
                # 변화 신호 기록
                result.append(Signal(frame_index, round(frame_index * 1000 / metadata.fps), max(motion, histogram_distance)))
            # 이전 신호 갱신
            previous_histogram = current
            previous_frame = small
            # 프레임 인덱스 증가
            frame_index += 1
    finally:
        capture.release()
    # 신호 결과 반환
    return tuple(result)
