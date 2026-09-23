# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 거리 계산과 수치 유효성 확인 도구 가져옴
import math
# 관측 필드 자료형 선언 도구 가져옴
from dataclasses import dataclass
# 화면 원형 후보 좌표 자료형 가져옴
from .ball import BallCandidate


@dataclass(frozen=True, slots=True)
# 복수 경로 중 선택 결과 자료형 선언
class PathSelection:
    # 선택한 원형 물체의 화면 좌표 보관
    candidate: BallCandidate | None
    # 선택 경로의 식별 번호 보관
    track_id: int | None
    # 선택 경로를 지지한 표본 횟수 보관
    support: int
    # 현재 유지 중인 경로 개수 보관
    active_paths: int
    # 경로 선택을 보류한 사유 보관
    reason: str | None


@dataclass(slots=True)
# 개별 후보 경로의 내부 상태 자료형 선언
class _Path:
    # 경로 고유 번호 보관
    identifier: int
    # 경로의 마지막 원형 후보 위치 보관
    point: BallCandidate
    # 마지막 위치의 원본 시각 보관
    time: int
    # 첫 후보 관측으로 지지 횟수 시작
    hits: int = 1
    # 후보 연결 비용의 시작값 설정
    cost: float = 0.0
    # 화면 가로 방향 초당 픽셀 이동량 초기화
    vx: float = 0.0
    # 화면 세로 방향 초당 픽셀 이동량 초기화
    vy: float = 0.0


# 복수 후보의 화면 좌표 경로 관리자 선언
class BallPaths:
    """여러 화면 좌표 경로를 유지하며 세 프레임 이상 지지된 우세 경로만 선택"""

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 유지할 경로의 빈 목록 생성
        self.paths: list[_Path] = []
        # 경로 식별 번호 시작값 설정
        self.serial = 0
        # 이전 원본 시각의 빈 값 생성
        self.last_time: int | None = None
        # 연속 구간과 영상 크기 경계 초기화
        self.boundary: tuple[int, int, int] | None = None
        # 이전 선택 경로 번호 초기화
        self.selected: int | None = None

    # 현재 후보와 이전 경로 연결 및 모호한 선택의 미확인 상태 유지
    def update(
        self,
        timestamp_ms: int,
        continuity_id: int,
        width: int,
        height: int,
        candidates: tuple[BallCandidate, ...],
    ) -> PathSelection:
        # 연결은 영상 좌표에서 수행하며 카메라 보정된 물리 속도로 해석 제외
        if (
            type(timestamp_ms) is not int
            or timestamp_ms < 0
            or (self.last_time is not None and timestamp_ms <= self.last_time)
        ):
            # 중복되거나 역행하는 경로 시각 오류 전달
            raise ValueError("path-time-not-increasing")
        # 추적에 필요한 최소 영상 크기 확인
        if width < 16 or height < 16:
            # 너무 작은 영상 크기 오류 전달
            raise ValueError("invalid-path-image-size")
        # 모든 후보의 유한한 좌표와 영상 경계 및 크기 범위 확인
        if any(
            not all(math.isfinite(v) for v in (p.x, p.y, p.radius, p.circularity))
            or not (
                0 <= p.x < width and 0 <= p.y < height and p.radius > 0 and 0 <= p.circularity <= 1
            )
            for p in candidates
        ):
            # 유효하지 않은 후보 좌표 오류 전달
            raise ValueError("invalid-path-candidate")
        # 연속 구간 번호와 화면 크기로 경계 표식 생성
        boundary = (continuity_id, width, height)
        # 경계 변경 또는 300밀리초 초과 공백 확인
        if boundary != self.boundary or (
            self.last_time is not None and timestamp_ms - self.last_time > 300
        ):
            # 연결할 수 없는 이전 경로 목록 초기화
            self.paths = []
            # 이전 선택 경로 초기화
            self.selected = None
        # 현재 경계 표식 저장
        self.boundary = boundary
        # 현재 원본 시각 저장
        self.last_time = timestamp_ms
        # 300밀리초 이내에 관측된 경로만 유지
        self.paths = [path for path in self.paths if timestamp_ms - path.time <= 300]
        # 후보 수가 처리 상한을 넘는지 확인
        if len(candidates) > 128:
            # 과다 후보로 인한 기존 경로 초기화
            self.paths = []
            # 과다 후보로 인한 기존 선택 초기화
            self.selected = None
            # 후보 과다 사유와 선택 보류 결과 반환
            return PathSelection(None, None, 0, 0, "TOO_MANY_CANDIDATES")

        # 비용과 경로 번호 및 후보 번호를 담을 연결 목록 생성
        edges: list[tuple[float, int, int]] = []
        # 유지 중인 각 경로 순회
        for path_index, path in enumerate(self.paths):
            # 이전 위치와 현재 표본 사이 초 단위 시간차 계산
            dt = (timestamp_ms - path.time) / 1000
            # 화면 좌표 이동량으로 다음 후보 위치 예상
            predicted = (path.point.x + path.vx * dt, path.point.y + path.vy * dt)
            # 시간 간격에 따라 허용할 연결 거리 계산
            gate = max(6.0, width * 0.04 * math.sqrt(dt / 0.067))
            # 현재 원형 후보별 연결 가능성 확인
            for index, candidate in enumerate(candidates):
                # 이전 후보 대비 반지름 비율 계산
                ratio = candidate.radius / path.point.radius
                # 예상 위치와 현재 후보 사이 픽셀 거리 계산
                distance = math.dist(predicted, (candidate.x, candidate.y))
                # 크기 변화와 거리의 연결 허용 범위 확인
                if 0.5 <= ratio <= 2.0 and distance <= gate:
                    # 거리와 크기 변화가 클수록 높아지는 연결 비용 계산
                    cost = distance / gate + abs(math.log(ratio)) * 0.4
                    # 가능한 경로와 후보의 연결 비용 기록
                    edges.append((cost, path_index, index))

        # 동점에 가까운 연결의 식별자순 강제 선택 금지
        edges.sort()
        # 연결 비용이 비슷한 경로 번호의 집합 생성
        tied_paths: set[int] = set()
        # 연결 비용이 비슷한 후보 번호의 집합 생성
        tied_candidates: set[int] = set()
        # 경로별 및 후보별 연결 모호성 검사
        for key_position, destination in ((1, tied_paths), (2, tied_candidates)):
            # 동일 경로 또는 후보의 비용 묶음 생성
            groups: dict[int, list[float]] = {}
            # 가능한 연결을 하나씩 확인
            for edge in edges:
                # 같은 번호를 사용하는 연결 비용 수집
                groups.setdefault(edge[key_position], []).append(edge[0])
            # 최저 두 비용 차이가 작은 번호를 모호한 대상으로 저장
            destination.update(
                key for key, costs in groups.items() if len(costs) > 1 and costs[1] - costs[0] < 0.1
            )
        # 이미 연결된 경로 번호의 집합 생성
        used_paths: set[int] = set()
        # 이미 연결된 후보 번호의 집합 생성
        used_candidates: set[int] = set()
        # 이번 표본과 연결된 경로 목록 생성
        matched: list[_Path] = []
        # 비용이 낮은 연결부터 순서대로 확인
        for cost, path_index, index in edges:
            # 이미 사용됐거나 모호한 경로와 후보 여부 확인
            if (
                path_index in used_paths
                or index in used_candidates
                or path_index in tied_paths
                or index in tied_candidates
            ):
                # 중복 또는 모호한 연결 건너뜀
                continue
            # 연결할 이전 경로 읽음
            path = self.paths[path_index]
            # 연결할 현재 후보 읽음
            point = candidates[index]
            # 이전 경로 위치와 현재 표본의 초 단위 시간차 계산
            dt = (timestamp_ms - path.time) / 1000
            # 가로 좌표 차이의 초당 픽셀 이동량 저장
            path.vx = (point.x - path.point.x) / dt
            # 세로 좌표 차이의 초당 픽셀 이동량 저장
            path.vy = (point.y - path.point.y) / dt
            # 긴 경로의 영구 우세 방지를 위한 지지 횟수 가중치 제한
            path.cost = cost if path.hits == 1 else path.cost * 0.5 + cost * 0.5
            # 경로 지지 횟수를 최대 여덟 회까지 증가
            path.hits = min(8, path.hits + 1)
            # 경로의 마지막 후보 위치 갱신
            path.point = point
            # 경로의 마지막 관측 시각 갱신
            path.time = timestamp_ms
            # 이번 표본에 연결된 경로 기록
            matched.append(path)
            # 경로의 중복 연결 방지를 위한 사용 표시
            used_paths.add(path_index)
            # 후보의 중복 연결 방지를 위한 사용 표시
            used_candidates.add(index)
        # 현재 후보 중 새 경로가 필요한 대상 순회
        for index, candidate in enumerate(candidates):
            # 이미 연결됐거나 연결이 모호한 후보 확인
            if index in used_candidates or index in tied_candidates:
                # 새 경로 생성 대상에서 해당 후보 제외
                continue
            # 새 경로의 고유 번호 증가
            self.serial += 1
            # 현재 후보를 시작점으로 새 경로 생성
            path = _Path(self.serial, candidate, timestamp_ms)
            # 유지 중인 전체 경로에 새 경로 추가
            self.paths.append(path)
            # 이번 표본의 관측 경로에도 새 경로 추가
            matched.append(path)
        # 기억 공간 제한과 경로 절단 시 현재 프레임 선택 보류
        overflow = len(self.paths) > 128
        # 최근 관측과 지지 횟수 및 낮은 비용 순으로 경로 정렬
        self.paths.sort(key=lambda path: (path.time, path.hits, -path.cost), reverse=True)
        # 메모리 상한에 맞춰 128개 경로만 유지
        self.paths = self.paths[:128]
        # 세 번 이상 지지된 현재 관측 경로 선택
        eligible = [path for path in matched if path.hits >= 3]
        # 지지 횟수와 연결 비용 및 원형도 점수식 생성
        score = lambda path: min(3, path.hits) - path.cost * 2 + path.point.circularity * 0.5
        # 높은 선택 점수 순으로 후보 경로 정렬
        eligible.sort(key=score, reverse=True)
        # 경로 잘림 또는 충분한 지지 경로 부재 확인
        if overflow or not eligible:
            # 확정할 수 없는 선택 경로 초기화
            self.selected = None
            # 준비 중 또는 가림 사유의 선택 보류 결과 반환
            return PathSelection(
                None, None, 0, len(self.paths), "PATHS_WARMING" if candidates else "OCCLUDED"
            )
        # 가장 높은 점수의 경로 선택
        best = eligible[0]
        # 기존 선택 경로 관측 시 사소한 순위 변동의 경로 전환 금지
        locked = next((path for path in eligible if path.identifier == self.selected), None)
        # 기존 선택과 새 최고 점수의 차이가 작은지 확인
        if locked is not None and score(best) - score(locked) < 0.25:
            # 사소한 점수 차이에는 기존 경로 유지
            best = locked
        # 비교할 다른 경로의 존재 확인
        elif len(eligible) > 1:
            # 최고 경로와 차순위 경로의 점수 차이 계산
            gap = score(best) - score(eligible[1])
            # 확실한 우세를 보장할 점수 차이 확인
            if gap < 0.25:
                # 모호한 경로 선택 초기화
                self.selected = None
                # 경로 우세 불명확 사유 반환
                return PathSelection(None, None, 0, len(self.paths), "AMBIGUOUS_PATHS")
        # 선택 경로 번호 저장
        self.selected = best.identifier
        # 선택한 화면 좌표와 지지 횟수 및 유지 경로 수 반환
        return PathSelection(best.point, best.identifier, best.hits, len(self.paths), None)
