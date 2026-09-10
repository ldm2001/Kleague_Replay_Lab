from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations

import cv2
import numpy as np

from ..domain.setpieces import RestartObservation, setpieces


@dataclass(frozen=True, slots=True)
class CornerGeometry:
    x: float
    y: float
    direction_x: float
    direction_y: float
    strength: float
    lower_slope: float
    upper_slope: float


def corner_geometry(frame: np.ndarray) -> CornerGeometry | None:
    """경기장 바깥쪽 두 경계선과 가느다란 깃대 색상을 함께 찾는다"""
    height, width = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    grass = cv2.inRange(hsv, (30, 40, 35), (95, 255, 255))
    if np.count_nonzero(grass) / grass.size < 0.2:
        return None
    white = cv2.inRange(hsv, (0, 0, 85), (179, 90, 255))
    white = cv2.bitwise_and(white, cv2.dilate(grass, np.ones((9, 9), np.uint8)))
    lines = cv2.HoughLinesP(white, 1, np.pi / 720, threshold=50, minLineLength=width * 0.12, maxLineGap=20)
    if lines is None:
        return None
    yellow = cv2.inRange(hsv, (20, 80, 140), (50, 255, 255))
    yellow = cv2.morphologyEx(yellow, cv2.MORPH_OPEN, np.ones((9, 1), np.uint8))
    contours, _ = cv2.findContours(yellow, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    poles = [(x + w / 2, y + h) for contour in contours for x, y, w, h in [cv2.boundingRect(contour)]
             if h >= height * 0.025 and w <= width * 0.015 and h / w >= 3]
    if not poles:
        return None
    segments = sorted((line[0].astype(float) for line in lines), key=lambda p: math.hypot(p[2] - p[0], p[3] - p[1]), reverse=True)[:40]
    best = None
    for first, second in combinations(segments, 2):
        a, b = first[:2], first[2:]
        c, d = second[:2], second[2:]
        u, v = b - a, d - c
        determinant = float(u[0] * v[1] - u[1] * v[0])
        if abs(determinant) < 1:
            continue
        delta = c - a
        t = float((delta[0] * v[1] - delta[1] * v[0]) / determinant)
        point = a + t * u
        x, y = point
        if not (width * 0.04 < x < width * 0.96 and height * 0.25 < y < height * 0.95):
            continue
        if width * 0.3 < x < width * 0.7:
            continue
        if min(math.dist(point, a), math.dist(point, b)) > width * 0.1 or min(math.dist(point, c), math.dist(point, d)) > width * 0.1:
            continue
        away1 = (a if math.dist(point, a) > math.dist(point, b) else b) - point
        away2 = (c if math.dist(point, c) > math.dist(point, d) else d) - point
        away1 /= np.linalg.norm(away1)
        away2 /= np.linalg.norm(away2)
        # 이 기준선은 비스듬한 두 경기장 선만 지원하며 가파른 골대 기둥은 제외한다
        if any(abs(ray[0]) < 0.6 for ray in (away1, away2)):
            continue
        angle = math.degrees(math.acos(float(np.clip(away1 @ away2, -1, 1))))
        if not 15 <= angle <= 75:
            continue
        direction = away1 + away2
        direction /= np.linalg.norm(direction)
        pole_distance = min(math.dist(point, pole) for pole in poles)
        if pole_distance > width * 0.012:
            continue
        # 경계 안쪽은 잔디이고 반대쪽은 경기장 바깥이어야 한다
        def coverage(sign):
            center = point + direction * width * 0.04 * sign
            px, py = int(center[0]), int(center[1])
            patch = grass[max(0, py - 8):min(height, py + 9), max(0, px - 8):min(width, px + 9)]
            return float(np.count_nonzero(patch) / patch.size) if patch.size else 0
        if coverage(1) < 0.45 or coverage(-1) > 0.35:
            continue
        strength = float(np.linalg.norm(u) + np.linalg.norm(v)) / width - pole_distance / width * 10
        if best is None or strength > best.strength:
            slopes = [float(ray[1] / ray[0]) for ray in (away1, away2) if abs(ray[0]) > 0.1]
            if len(slopes) != 2:
                continue
            lower = min(slopes) if direction[0] < 0 else max(slopes)
            upper = max(slopes) if direction[0] < 0 else min(slopes)
            best = CornerGeometry(float(x), float(y), float(direction[0]), float(direction[1]), strength, lower, upper)
    return best


def departing_points(frame: np.ndarray, previous: np.ndarray | None, geometry: CornerGeometry) -> tuple[tuple[float, float], ...]:
    """코너에서 경기장 방향으로 나가는 작고 밝은 이동 성분을 찾는다"""
    if previous is None or previous.shape != frame.shape:
        return ()
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 고정된 예비공과 선분은 프레임 차이가 없는 부분에서 제외한다
    difference = cv2.absdiff(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY))
    change_mask = np.uint8(difference >= 30) * 255
    change_mask = cv2.morphologyEx(change_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    change_mask = cv2.bitwise_and(change_mask, cv2.inRange(hsv, (0, 0, 65), (179, 150, 255)))
    contours, _ = cv2.findContours(change_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    width = frame.shape[1]
    points = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if not (2 <= w <= 40 and 2 <= h <= 28 and 0.25 <= w / h <= 6 and 2 <= cv2.contourArea(contour) <= 400):
            continue
        patch = difference[y:y + h, x:x + w]
        if patch.size == 0 or float(patch.mean()) < 25 or float(np.mean(patch >= 20)) < 0.35:
            continue
        cx, cy = x + w / 2, y + h / 2
        dx, dy = cx - geometry.x, cy - geometry.y
        distance = math.hypot(dx, dy)
        forward = dx * geometry.direction_x + dy * geometry.direction_y
        lower_y = geometry.y + geometry.lower_slope * dx
        upper_y = geometry.y + geometry.upper_slope * dx
        if cy > lower_y + 3 or upper_y - cy > distance * 0.4 + 6:
            continue
        # 카메라의 미세 이동으로 밝아진 경계선 조각을 공 궤적으로 연결하지 않는다
        if abs(cy - lower_y) < 5 or abs(cy - upper_y) < 3:
            continue
        if distance <= width * 0.75 and forward > 0 and forward / max(1, distance) >= 0.65:
            points.append((cx, cy))
    return tuple(points)


class CornerRecognizer:
    """코너 경계의 준비 구간과 코너에서 출발하는 연속 이동 경로를 연결한다"""

    def __init__(self) -> None:
        self.geometry: CornerGeometry | None = None
        self.prepared_at: int | None = None
        self.preparation_times: list[int] = []
        self.last_geometry_at = 0
        self.previous: np.ndarray | None = None
        self.last_time: int | None = None
        self.continuity: int | None = None
        self.paths: list[list[tuple[int, float, float]]] = []
        self.cooldown_until = 0
        self.last_departure: list[tuple[int, float, float]] = []

    def update(self, frame: np.ndarray, timestamp_ms: int, continuity: int) -> dict | None:
        if self.last_time is not None and timestamp_ms <= self.last_time:
            raise ValueError("corner-time-not-increasing")
        if continuity != self.continuity or (self.last_time is not None and timestamp_ms - self.last_time > 250):
            self.geometry = None
            self.prepared_at = None
            self.preparation_times = []
            self.previous = None
            self.paths = []
        self.last_time = timestamp_ms
        self.continuity = continuity
        size = (960, max(16, round(frame.shape[0] * 960 / frame.shape[1])))
        image = cv2.resize(frame, size)
        previous = self.previous
        self.previous = image
        if timestamp_ms < self.cooldown_until:
            return None
        detected = corner_geometry(image)
        if detected is not None:
            if self.geometry is None or math.dist((detected.x, detected.y), (self.geometry.x, self.geometry.y)) > 35:
                self.prepared_at = timestamp_ms
                self.preparation_times = [timestamp_ms]
                self.paths = []
            self.geometry = detected
            self.last_geometry_at = timestamp_ms
        if self.geometry is None or timestamp_ms - self.last_geometry_at > 700:
            self.geometry = None
            self.prepared_at = None
            self.preparation_times = []
            self.paths = []
            return None
        if not self.preparation_times or timestamp_ms - self.preparation_times[-1] >= 500:
            self.preparation_times.append(timestamp_ms)
        if self.prepared_at is None or timestamp_ms - self.prepared_at < 180 or previous is None:
            return None
        # 카메라 자체의 큰 이동은 공의 출발로 해석하지 않는다
        shift, response = cv2.phaseCorrelate(np.float32(cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)), np.float32(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)))
        if response < 0.2 or math.hypot(*shift) > 10:
            self.paths = []
            return None
        aligned = cv2.warpAffine(previous, np.float32([[1, 0, shift[0]], [0, 1, shift[1]]]), size)
        points = departing_points(image, aligned, self.geometry)
        next_paths = []
        for path in self.paths:
            last = np.array(path[-1][1:])
            for point in points:
                delta = np.array(point) - last
                distance = float(np.linalg.norm(delta))
                forward = delta[0] * self.geometry.direction_x + delta[1] * self.geometry.direction_y
                if not 9 <= distance <= 180 or forward / max(1, distance) < 0.8:
                    continue
                if len(path) >= 2:
                    older = last - np.array(path[-2][1:])
                    cosine = float(older @ delta / max(1, np.linalg.norm(older) * distance))
                    if cosine < 0.95 or not 0.5 <= distance / max(1, np.linalg.norm(older)) <= 2:
                        continue
                extended = path + [(timestamp_ms, *point)]
                if len(extended) >= 4 and math.dist(extended[0][1:], point) >= 90:
                    first = extended[0][0]
                    # 영상 패턴만 전달하며 실제 경기 중단과 인플레이 상태는 입력하지 않는다
                    # 실제로 처리한 준비 프레임을 보존해 긴 준비를 관찰 공백으로 만들지 않는다
                    preparation = sorted(set([time for time in self.preparation_times if time < first] + [first]))
                    sequence = [RestartObservation(time, continuity, preparation_detected=True,
                                restart_candidates=("CORNER_KICK",), evidence_ids=(f"frame:{time}",)) for time in preparation]
                    sequence.append(RestartObservation(timestamp_ms, continuity, departure_detected=True,
                                                       evidence_ids=(f"frame:{timestamp_ms}",)))
                    result = setpieces(sequence, require_live_source=False, visual_pattern=True)
                    if not result or result[0].status != "OBSERVED":
                        continue
                    self.cooldown_until = timestamp_ms + 5000
                    self.last_departure = extended
                    self.paths = []
                    return {
                        "kind": "CORNER_KICK", "status": "OBSERVED", "startMs": self.prepared_at,
                        "endMs": timestamp_ms + 1, "restartMs": first,
                        "evidenceTimestampsMs": sorted(set([self.prepared_at] + [step[0] for step in extended])),
                        "method": "corner-geometry-motion-v1",
                    }
                next_paths.append(extended)
        for point in points:
            if math.dist(point, (self.geometry.x, self.geometry.y)) < 115 and abs(point[1] - self.geometry.y) < 45:
                next_paths.append([(timestamp_ms, *point)])
        # 분기 폭주 시 임의의 경로를 확정하지 않고 해당 프레임을 보류한다
        self.paths = next_paths if len(next_paths) <= 128 else []
        return None
