from __future__ import annotations

import math
from dataclasses import dataclass

from .ball import BallCandidate


@dataclass(frozen=True, slots=True)
class PathSelection:
    candidate: BallCandidate | None
    track_id: int | None
    support: int
    active_paths: int
    reason: str | None


@dataclass(slots=True)
class _Path:
    identifier: int
    point: BallCandidate
    time: int
    hits: int = 1
    cost: float = 0.0
    vx: float = 0.0
    vy: float = 0.0


class BallPaths:
    """여러 화면 좌표 경로를 유지하며 세 프레임 이상 지지된 우세 경로만 선택한다"""

    def __init__(self) -> None:
        self.paths: list[_Path] = []
        self.serial = 0
        self.last_time: int | None = None
        self.boundary: tuple[int, int, int] | None = None
        self.selected: int | None = None

    def update(self, timestamp_ms: int, continuity_id: int, width: int, height: int,
               candidates: tuple[BallCandidate, ...]) -> PathSelection:
        # 연결은 영상 좌표에서 수행하며 카메라 보정된 물리 속도로 해석하지 않는다
        if type(timestamp_ms) is not int or timestamp_ms < 0 or (self.last_time is not None and timestamp_ms <= self.last_time):
            raise ValueError("path-time-not-increasing")
        if width < 16 or height < 16:
            raise ValueError("invalid-path-image-size")
        if any(not all(math.isfinite(v) for v in (p.x, p.y, p.radius, p.circularity)) or
               not (0 <= p.x < width and 0 <= p.y < height and p.radius > 0 and 0 <= p.circularity <= 1) for p in candidates):
            raise ValueError("invalid-path-candidate")
        boundary = (continuity_id, width, height)
        if boundary != self.boundary or (self.last_time is not None and timestamp_ms - self.last_time > 300):
            self.paths = []
            self.selected = None
        self.boundary = boundary
        self.last_time = timestamp_ms
        self.paths = [path for path in self.paths if timestamp_ms - path.time <= 300]
        if len(candidates) > 128:
            self.paths = []
            self.selected = None
            return PathSelection(None, None, 0, 0, "TOO_MANY_CANDIDATES")

        edges: list[tuple[float, int, int]] = []
        for path_index, path in enumerate(self.paths):
            dt = (timestamp_ms - path.time) / 1000
            predicted = (path.point.x + path.vx * dt, path.point.y + path.vy * dt)
            gate = max(6.0, width * 0.04 * math.sqrt(dt / 0.067))
            for index, candidate in enumerate(candidates):
                ratio = candidate.radius / path.point.radius
                distance = math.dist(predicted, (candidate.x, candidate.y))
                if 0.5 <= ratio <= 2.0 and distance <= gate:
                    cost = distance / gate + abs(math.log(ratio)) * 0.4
                    edges.append((cost, path_index, index))

        # 동점에 가까운 연결은 식별자 순서로 강제 선택하지 않는다
        edges.sort()
        tied_paths: set[int] = set()
        tied_candidates: set[int] = set()
        for key_position, destination in ((1, tied_paths), (2, tied_candidates)):
            groups: dict[int, list[float]] = {}
            for edge in edges:
                groups.setdefault(edge[key_position], []).append(edge[0])
            destination.update(key for key, costs in groups.items() if len(costs) > 1 and costs[1] - costs[0] < 0.1)
        used_paths: set[int] = set()
        used_candidates: set[int] = set()
        matched: list[_Path] = []
        for cost, path_index, index in edges:
            if path_index in used_paths or index in used_candidates or path_index in tied_paths or index in tied_candidates:
                continue
            path = self.paths[path_index]
            point = candidates[index]
            dt = (timestamp_ms - path.time) / 1000
            path.vx = (point.x - path.point.x) / dt
            path.vy = (point.y - path.point.y) / dt
            # 긴 경로 하나가 영구 우세하지 않게 지지 횟수의 가중치를 제한한다
            path.cost = cost if path.hits == 1 else path.cost * 0.5 + cost * 0.5
            path.hits = min(8, path.hits + 1)
            path.point = point
            path.time = timestamp_ms
            matched.append(path)
            used_paths.add(path_index)
            used_candidates.add(index)
        for index, candidate in enumerate(candidates):
            if index in used_candidates or index in tied_candidates:
                continue
            self.serial += 1
            path = _Path(self.serial, candidate, timestamp_ms)
            self.paths.append(path)
            matched.append(path)
        # 기억 공간은 제한하지만 잘린 경로가 있으면 이번 프레임의 선택은 보류한다
        overflow = len(self.paths) > 128
        self.paths.sort(key=lambda path: (path.time, path.hits, -path.cost), reverse=True)
        self.paths = self.paths[:128]
        eligible = [path for path in matched if path.hits >= 3]
        score = lambda path: min(3, path.hits) - path.cost * 2 + path.point.circularity * 0.5
        eligible.sort(key=score, reverse=True)
        if overflow or not eligible:
            self.selected = None
            return PathSelection(None, None, 0, len(self.paths), "PATHS_WARMING" if candidates else "OCCLUDED")
        best = eligible[0]
        # 이전에 선택한 경로가 여전히 관측되면 사소한 순위 변화로 전환하지 않는다
        locked = next((path for path in eligible if path.identifier == self.selected), None)
        if locked is not None and score(best) - score(locked) < 0.25:
            best = locked
        elif len(eligible) > 1:
            gap = score(best) - score(eligible[1])
            if gap < 0.25:
                self.selected = None
                return PathSelection(None, None, 0, len(self.paths), "AMBIGUOUS_PATHS")
        self.selected = best.identifier
        return PathSelection(best.point, best.identifier, best.hits, len(self.paths), None)
