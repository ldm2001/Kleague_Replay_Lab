from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from ..domain.models import VideoMetadata


@dataclass(frozen=True, slots=True)
class Signal:
    frame_index: int
    timestamp_ms: int
    score: float


def _histogram(frame: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
    return cv2.normalize(histogram, histogram).flatten()


def signals(source: Path | str, metadata: VideoMetadata, sample_fps: float = 10.0) -> tuple[Signal, ...]:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("video-open-failed")

    stride = max(1, round(metadata.fps / max(sample_fps, 1.0)))
    result: list[Signal] = []
    previous_histogram: np.ndarray | None = None
    previous_frame: np.ndarray | None = None
    frame_index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % stride != 0:
                frame_index += 1
                continue

            small = cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA)
            current = _histogram(small)
            if previous_histogram is not None and previous_frame is not None:
                motion = float(cv2.absdiff(previous_frame, small).mean() / 255.0)
                histogram_distance = float(cv2.compareHist(previous_histogram, current, cv2.HISTCMP_BHATTACHARYYA))
                result.append(Signal(frame_index, round(frame_index * 1000 / metadata.fps), max(motion, histogram_distance)))
            previous_histogram = current
            previous_frame = small
            frame_index += 1
    finally:
        capture.release()
    return tuple(result)
