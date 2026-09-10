from __future__ import annotations

import math

import cv2
import numpy as np

from ..domain.ball import BallCandidate
from .context import _field, _image


def ball_candidates(frame: np.ndarray) -> tuple[BallCandidate, ...]:
    """경기장과 인접 공중 영역의 작은 밝은 물체를 찾으며 공임을 확정하지 않는다"""
    image = _image(frame)
    grass, _ = _field(image)
    if np.count_nonzero(grass) / grass.size < 0.2:
        return ()
    # 화면 위의 녹색 로고와 작은 광고 영역이 탐색 띠를 만들지 않도록 주 잔디 영역만 사용한다
    count, components, stats, _ = cv2.connectedComponentsWithStats(grass, connectivity=8)
    if count <= 1:
        return ()
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    grass = np.where(components == largest, 255, 0).astype(np.uint8)
    # 떠 있는 공은 잔디와 붙어 있지 않을 수 있어 수직 탐색 띠를 넓힌다
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    bright = cv2.inRange(hsv, (0, 0, 160), (179, 65, 255))
    margin = max(12, round(image.shape[0] * 0.15))
    search_area = cv2.dilate(grass, np.ones((2 * margin + 1, 9), dtype=np.uint8))
    white = cv2.bitwise_and(bright, search_area)
    contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = grass.shape
    candidates: list[BallCandidate] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        # 잘린 화면 가장자리와 긴 선분은 중심 위치를 안정적으로 추적할 수 없다
        if min(w, h) < 3 or max(w, h) > 18 or not 0.55 <= w / h <= 1.8:
            continue
        if x == 0 or y == 0 or x + w >= width or y + h >= height:
            continue
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        circularity = 4 * math.pi * area / (perimeter * perimeter) if perimeter else 0
        if area < 5 or circularity < 0.55:
            continue
        neighborhood = search_area[max(0, y - 4):min(height, y + h + 4), max(0, x - 4):min(width, x + w + 4)]
        if np.count_nonzero(neighborhood) / neighborhood.size < 0.35:
            continue
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        candidates.append(BallCandidate(round(cx, 4), round(cy, 4), round(radius, 4), round(min(1, circularity), 6)))
    return tuple(sorted(candidates, key=lambda point: (point.x, point.y)))
