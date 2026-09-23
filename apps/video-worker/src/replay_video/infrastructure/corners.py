from __future__ import annotations
import math
from dataclasses import dataclass
from itertools import combinations
import cv2
import numpy as np
from ..domain.setpieces import RestartObservation, setpieces


@dataclass(frozen=True, slots=True)
class CornerGeometry:
    # 분석 화면에서 코너 경계 교점의 가로 좌표 보존
    x: float
    # 분석 화면에서 코너 경계 교점의 세로 좌표 보존
    y: float
    # 코너에서 경기장 안쪽을 향하는 단위 벡터의 가로 성분 보존
    direction_x: float
    # 코너에서 경기장 안쪽을 향하는 단위 벡터의 세로 성분 보존
    direction_y: float
    # 선분 길이와 깃대 근접도로 계산한 기하 후보 점수 보존
    strength: float
    # 화면상 아래 경계선의 기울기 보존
    lower_slope: float
    # 화면상 위 경계선의 기울기 보존
    upper_slope: float

# 경계선 교점·깃대 형태 기반 코너 기하 추정
def geometry(frame: np.ndarray) -> CornerGeometry | None:
    """경기장 바깥쪽 두 경계선과 가느다란 깃대 색상을 함께 검색"""
    # 기하 조건을 화면 크기에 비례시키기 위한 해상도 읽음
    height, width = frame.shape[:2]
    # 잔디·경계·깃대 색상을 분리할 색상 공간으로 변환
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 잔디색 후보 픽셀 마스크 생성
    grass = cv2.inRange(hsv, (30, 40, 35), (95, 255, 255))
    # 경기장 기하를 찾을 잔디 영역이 충분한지 확인
    if np.count_nonzero(grass) / grass.size < 0.2:
        # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
        return None
    # 경계선이 될 밝고 낮은 채도의 픽셀 추출
    white = cv2.inRange(hsv, (0, 0, 85), (179, 90, 255))
    # 잔디 주변에 있는 흰색 선 후보만 유지
    white = cv2.bitwise_and(white, cv2.dilate(grass, np.ones((9, 9), np.uint8)))
    # 경기장 경계 후보가 될 긴 흰색 선분 탐색
    lines = cv2.HoughLinesP(
        white, 1, np.pi / 720, threshold=50, minLineLength=width * 0.12, maxLineGap=20
    )
    # 경계선 후보가 검출되지 않은 경우 확인
    if lines is None:
        # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
        return None
    # 깃대 형태 탐색용 노란색 계열 픽셀 추출
    yellow = cv2.inRange(hsv, (20, 80, 140), (50, 255, 255))
    # 세로로 긴 노란색 성분을 남기고 작은 잡음 제거
    yellow = cv2.morphologyEx(yellow, cv2.MORPH_OPEN, np.ones((9, 1), np.uint8))
    # 노란색 연결 영역의 외곽 윤곽선 추출
    contours, _ = cv2.findContours(yellow, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # 가늘고 긴 색상 영역의 하단을 깃대 후보 위치로 수집
    poles = [
        (x + w / 2, y + h)
        for contour in contours
        for x, y, w, h in [cv2.boundingRect(contour)]
        if h >= height * 0.025 and w <= width * 0.015 and h / w >= 3
    ]
    # 코너 교점을 지지할 깃대 형태 후보가 있는지 확인
    if not poles:
        # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
        return None
    # 길이가 긴 순서로 경계 후보 선분을 최대 마흔 개 선택
    segments = sorted(
        (line[0].astype(float) for line in lines),
        key=lambda p: math.hypot(p[2] - p[0], p[3] - p[1]),
        reverse=True,
    )[:40]
    # 조건을 만족하는 코너 기하가 아직 없음을 기록
    best = None
    # 두 경계선 조합마다 코너 교점 후보 평가
    for first, second in combinations(segments, 2):
        # 첫 경계 후보 선분의 양 끝 좌표 분리
        a, b = first[:2], first[2:]
        # 둘째 경계 후보 선분의 양 끝 좌표 분리
        c, d = second[:2], second[2:]
        # 두 선분의 방향 벡터 계산
        u, v = b - a, d - c
        # 두 직선이 교차 가능한지 검사할 외적 계산
        determinant = float(u[0] * v[1] - u[1] * v[0])
        # 거의 평행해 교점이 불안정한 선분 조합인지 확인
        if abs(determinant) < 1:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 두 선분 시작점의 위치 차이 계산
        delta = c - a
        # 첫 직선 위 교점의 매개 위치 계산
        t = float((delta[0] * v[1] - delta[1] * v[0]) / determinant)
        # 두 경계 직선의 화면 교점 계산
        point = a + t * u
        # 교점의 가로·세로 좌표 분리
        x, y = point
        # 지원하는 화면 내부 위치에 교점이 있는지 확인
        if not (width * 0.04 < x < width * 0.96 and height * 0.25 < y < height * 0.95):
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 현재 방법이 지원하지 않는 화면 중앙 교점 제외
        if width * 0.3 < x < width * 0.7:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 교점이 실제 두 선분 끝에서 너무 멀리 떨어져 있지 않은지 확인
        if (
            min(math.dist(point, a), math.dist(point, b)) > width * 0.1
            or min(math.dist(point, c), math.dist(point, d)) > width * 0.1
        ):
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 교점에서 첫 선분의 먼 끝을 향하는 방향 계산
        away1 = (a if math.dist(point, a) > math.dist(point, b) else b) - point
        # 교점에서 둘째 선분의 먼 끝을 향하는 방향 계산
        away2 = (c if math.dist(point, c) > math.dist(point, d) else d) - point
        # 첫 경계 방향을 길이 일의 벡터로 정규화
        away1 /= np.linalg.norm(away1)
        # 둘째 경계 방향을 길이 일의 벡터로 정규화
        away2 /= np.linalg.norm(away2)
        # 이 기준선은 비스듬한 두 경기장 선만 지원하며 가파른 골대 기둥은 제외
        if any(abs(ray[0]) < 0.6 for ray in (away1, away2)):
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 두 경계가 화면에서 이루는 각도 계산
        angle = math.degrees(math.acos(float(np.clip(away1 @ away2, -1, 1))))
        # 지원하는 비스듬한 경기장 코너 각도 범위 확인
        if not 15 <= angle <= 75:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 두 경계 사이의 경기장 안쪽 방향 근사
        direction = away1 + away2
        # 경기장 안쪽 방향을 단위 벡터로 정규화
        direction /= np.linalg.norm(direction)
        # 교점에 가장 가까운 깃대 형태 후보 거리 계산
        pole_distance = min(math.dist(point, pole) for pole in poles)
        # 경계 교점과 깃대 하단의 근접 조건 확인
        if pole_distance > width * 0.012:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue

        # 경계 안쪽 잔디·반대쪽 경기장 바깥 조건
        def coverage(sign):
            # 교점 안쪽 또는 바깥쪽의 잔디 검사 중심 계산
            center = point + direction * width * 0.04 * sign
            # 검사 중심을 이미지 배열의 정수 좌표로 변환
            px, py = int(center[0]), int(center[1])
            # 화면 경계를 지키며 교점 주변 잔디 검사 영역 추출
            patch = grass[max(0, py - 8):min(height, py + 9), max(0, px - 8):min(width, px + 9)]
            # 검사 영역의 잔디색 점유율 반환
            return float(np.count_nonzero(patch) / patch.size) if patch.size else 0
        # 안쪽은 잔디이며 반대쪽은 잔디가 적은 코너 패턴인지 확인
        if coverage(1) < 0.45 or coverage(-1) > 0.35:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 긴 경계선과 가까운 깃대를 선호하는 후보 점수 계산
        strength = float(np.linalg.norm(u) + np.linalg.norm(v)) / width - pole_distance / width * 10
        # 지금까지 가장 강한 기하 후보보다 나은지 확인
        if best is None or strength > best.strength:
            # 수직에 가깝지 않은 두 경계선의 화면 기울기 계산
            slopes = [float(ray[1] / ray[0]) for ray in (away1, away2) if abs(ray[0]) > 0.1]
            # 위아래 경계 기울기를 모두 계산할 수 있는지 확인
            if len(slopes) != 2:
                # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
                continue
            # 경기장 안쪽 방향에 따른 아래 경계 기울기 선택
            lower = min(slopes) if direction[0] < 0 else max(slopes)
            # 경기장 안쪽 방향에 따른 위 경계 기울기 선택
            upper = max(slopes) if direction[0] < 0 else min(slopes)
            # 교점과 안쪽 방향 및 경계 기울기의 최선 후보 보존
            best = CornerGeometry(
                float(x), float(y), float(direction[0]), float(direction[1]), strength, lower, upper
            )
    # 가장 잘 맞는 화면 코너 기하 또는 미관측 상태 반환
    return best

# 코너 부근에서 경기장 안쪽으로 움직이는 점 후보를 검색
def departure(
    frame: np.ndarray, previous: np.ndarray | None, geometry: CornerGeometry
) -> tuple[tuple[float, float], ...]:
    """코너에서 경기장 방향으로 나가는 작고 밝은 이동 성분을 검색"""
    # 변화를 비교할 같은 크기의 이전 화면 존재 여부 확인
    if previous is None or previous.shape != frame.shape:
        # 이전 화면 비교가 불가하면 출발 물체 후보 없이 반환
        return ()
    # 잔디·경계·깃대 색상을 분리할 색상 공간으로 변환
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 고정된 예비공과 선분은 프레임 차이가 없는 부분에서 제외
    difference = cv2.absdiff(
        cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
    )
    # 일정 밝기 이상 바뀐 화면 픽셀만 이동 성분으로 선택
    change_mask = np.uint8(difference >= 30) * 255
    # 작은 변화 잡음을 제거하고 연결된 이동 성분 유지
    change_mask = cv2.morphologyEx(change_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # 밝은 물체 조건과 변화 조건이 함께 성립하는 픽셀 선택
    change_mask = cv2.bitwise_and(change_mask, cv2.inRange(hsv, (0, 0, 65), (179, 150, 255)))
    # 이동 성분의 물체별 윤곽선 추출
    contours, _ = cv2.findContours(change_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # 화면 크기에 비례한 출발 거리 한계를 위한 너비 읽음
    width = frame.shape[1]
    # 아직 공으로 확정하지 않은 이동 중심 후보 목록 생성
    points = []
    # 각 이동 성분의 크기와 변화 강도 확인
    for contour in contours:
        # 이동 윤곽선의 화면 사각형 계산
        x, y, w, h = cv2.boundingRect(contour)
        # 이동 성분이 지원하는 작은 물체 크기와 면적 범위인지 확인
        if not (
            2 <= w <= 40
            and 2 <= h <= 28
            and 0.25 <= w / h <= 6
            and 2 <= cv2.contourArea(contour) <= 400
        ):
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 현재 물체 영역의 밝기 차이 추출
        patch = difference[y:y + h, x:x + w]
        # 실제 차이가 약하거나 변화 픽셀이 부족한 영역인지 확인
        if patch.size == 0 or float(patch.mean()) < 25 or float(np.mean(patch >= 20)) < 0.35:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 이동 성분 사각형의 화면 중심 계산
        cx, cy = x + w / 2, y + h / 2
        # 코너 교점에서 물체 중심까지의 화면 벡터 계산
        dx, dy = cx - geometry.x, cy - geometry.y
        # 코너 교점과 물체 중심의 픽셀 거리 계산
        distance = math.hypot(dx, dy)
        # 물체 위치가 경기장 안쪽 방향으로 얼마나 떨어졌는지 계산
        forward = dx * geometry.direction_x + dy * geometry.direction_y
        # 물체 가로 위치에서 아래 경계의 예상 세로 좌표 계산
        lower_y = geometry.y + geometry.lower_slope * dx
        # 물체 가로 위치에서 위 경계의 예상 세로 좌표 계산
        upper_y = geometry.y + geometry.upper_slope * dx
        # 지원하는 경기장 내부·인접 공중 범위에서 벗어나는지 확인
        if cy > lower_y + 3 or upper_y - cy > distance * 0.4 + 6:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 카메라의 미세 이동으로 밝아진 경계선 조각을 공 궤적으로 연결 금지
        if abs(cy - lower_y) < 5 or abs(cy - upper_y) < 3:
            # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
            continue
        # 코너 주변에서 경기장 안쪽으로 향하는 위치 조건 확인
        if distance <= width * 0.75 and forward > 0 and forward / max(1, distance) >= 0.65:
            # 조건에 맞는 밝은 이동 성분 중심 보존
            points.append((cx, cy))
    # 코너 출발 경로에 연결할 미확정 화면 점 후보 반환
    return tuple(points)


class CornerRecognizer:
    """코너 경계의 준비 구간과 코너에서 출발하는 연속 이동 경로를 연결"""

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 지속 확인 중인 코너 기하 초기화
        self.geometry: CornerGeometry | None = None
        # 현재 코너 준비 패턴의 시작 시각 초기화
        self.prepared_at: int | None = None
        # 준비 패턴을 실제 관측한 원본 시각 목록 생성
        self.preparation_times: list[int] = []
        # 코너 기하를 마지막으로 검출한 시각 초기화
        self.last_geometry_at = 0
        # 다음 표본 변화 비교용 이전 화면 초기화
        self.previous: np.ndarray | None = None
        # 시간 순서 검사용 마지막 표본 시각 초기화
        self.last_time: int | None = None
        # 이전 화면 연속 구간 식별자 초기화
        self.continuity: int | None = None
        # 가능한 코너 출발 경로 분기 목록 생성
        self.paths: list[list[tuple[int, float, float]]] = []
        # 같은 출발 패턴의 중복 출력을 막을 대기 종료 시각 초기화
        self.cooldown_until = 0
        # 마지막으로 관측한 출발 경로의 진단 근거 초기화
        self.last_departure: list[tuple[int, float, float]] = []

    # 코너 기하의 지속성과 물체의 출발 경로를 결합해 영상 패턴을 기록
    def update(self, frame: np.ndarray, timestamp_ms: int, continuity: int) -> dict | None:
        # 원본 표본 시각이 중복되거나 뒤로 가는지 확인
        if self.last_time is not None and timestamp_ms <= self.last_time:
            # 역행하는 시각으로 경로를 연결하지 않도록 거부
            raise ValueError("corner-time-not-increasing")
        # 샷 연속성이 바뀌거나 표본 사이가 너무 벌어졌는지 확인
        if continuity != self.continuity or (
            self.last_time is not None and timestamp_ms - self.last_time > 250
        ):
            # 이전 코너 기하의 연결 상태 해제
            self.geometry = None
            # 이전 코너 준비 시작 시각 해제
            self.prepared_at = None
            # 이전 준비 패턴의 관측 시각 목록 비움
            self.preparation_times = []
            # 연속성이 끊긴 이전 화면 참조 해제
            self.previous = None
            # 조건이 끊긴 출발 경로 후보를 다음 표본에 이어붙이지 않음
            self.paths = []
        # 다음 표본의 시간 순서 검사 기준 갱신
        self.last_time = timestamp_ms
        # 현재 화면 연속 구간 식별자 보존
        self.continuity = continuity
        # 종횡비를 유지하는 코너 분석 해상도 계산
        size = (960, max(16, round(frame.shape[0] * 960 / frame.shape[1])))
        # 코너 기하의 고정 픽셀 기준에 맞게 화면 크기 변환
        image = cv2.resize(frame, size)
        # 이번 변화 비교에 사용할 직전 분석 화면 읽음
        previous = self.previous
        # 다음 표본을 위한 현재 분석 화면 보존
        self.previous = image
        # 직전 출발 출력의 중복 방지 기간인지 확인
        if timestamp_ms < self.cooldown_until:
            # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
            return None
        # 현재 화면의 코너 경계와 깃대 기하 탐색
        detected = geometry(image)
        # 현재 표본에서 코너 기하가 관측되었는지 확인
        if detected is not None:
            # 코너를 처음 보거나 교점 위치가 크게 달라진 경우 새 준비 구간 시작
            if (
                self.geometry is None
                or math.dist((detected.x, detected.y), (self.geometry.x, self.geometry.y)) > 35
            ):
                # 새 위치의 코너 준비 패턴 시작 시각 기록
                self.prepared_at = timestamp_ms
                # 새 코너 준비 패턴의 첫 근거 시각 보존
                self.preparation_times = [timestamp_ms]
                # 조건이 끊긴 출발 경로 후보를 다음 표본에 이어붙이지 않음
                self.paths = []
            # 가장 최근 코너 기하로 분석 기준 갱신
            self.geometry = detected
            # 코너 기하를 실제 검출한 마지막 시각 갱신
            self.last_geometry_at = timestamp_ms
        # 코너 기하가 없거나 너무 오래 관측되지 않았는지 확인
        if self.geometry is None or timestamp_ms - self.last_geometry_at > 700:
            # 이전 코너 기하의 연결 상태 해제
            self.geometry = None
            # 이전 코너 준비 시작 시각 해제
            self.prepared_at = None
            # 이전 준비 패턴의 관측 시각 목록 비움
            self.preparation_times = []
            # 조건이 끊긴 출발 경로 후보를 다음 표본에 이어붙이지 않음
            self.paths = []
            # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
            return None
        # 준비 근거를 일정 간격으로 보존할 시점인지 확인
        if not self.preparation_times or timestamp_ms - self.preparation_times[-1] >= 500:
            # 지속된 준비 구간의 현재 근거 시각 추가
            self.preparation_times.append(timestamp_ms)
        # 준비 지속 시간과 이전 화면이 출발 검사에 충분한지 확인
        if self.prepared_at is None or timestamp_ms - self.prepared_at < 180 or previous is None:
            # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
            return None
        # 카메라 자체의 큰 이동은 공의 출발로 해석 제외
        shift, response = cv2.phaseCorrelate(
            np.float32(cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)),
            np.float32(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)),
        )
        # 전역 이동 추정이 약하거나 카메라 이동이 너무 큰지 확인
        if response < 0.2 or math.hypot(*shift) > 10:
            # 조건이 끊긴 출발 경로 후보를 다음 표본에 이어붙이지 않음
            self.paths = []
            # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
            return None
        # 작은 카메라 평행 이동을 이전 화면에 보정
        aligned = cv2.warpAffine(previous, np.float32([[1, 0, shift[0]], [0, 1, shift[1]]]), size)
        # 카메라 이동 보정 후 코너 출발 점 후보 탐색
        points = departure(image, aligned, self.geometry)
        # 이번 표본까지 이어지는 새 경로 분기 목록 생성
        next_paths = []
        # 기존 출발 경로마다 연결 가능한 현재 점 탐색
        for path in self.paths:
            # 이전 경로 마지막 점의 화면 좌표 읽음
            last = np.array(path[-1][1:])
            # 현재 이동 성분 중심을 기존 경로 또는 신규 경로에 연결
            for point in points:
                # 직전 경로 끝과 현재 후보 점의 이동 벡터 계산
                delta = np.array(point) - last
                # 연속 표본 사이의 픽셀 이동 거리 계산
                distance = float(np.linalg.norm(delta))
                # 현재 이동이 경기장 안쪽을 향하는 성분 계산
                forward = (
                    delta[0] * self.geometry.direction_x + delta[1] * self.geometry.direction_y
                )
                # 출발 경로에 맞는 이동 거리와 방향 일관성 확인
                if not 9 <= distance <= 180 or forward / max(1, distance) < 0.8:
                    # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
                    continue
                # 직전 이동 방향과 속도를 비교할 두 표본이 있는지 확인
                if len(path) >= 2:
                    # 이전 두 경로 점의 이동 벡터 계산
                    older = last - np.array(path[-2][1:])
                    # 직전 이동과 현재 이동 사이의 방향 유사도 계산
                    cosine = float(older @ delta / max(1, np.linalg.norm(older) * distance))
                    # 경로가 급격히 꺾이거나 이동 거리가 크게 달라지는지 확인
                    if cosine < 0.95 or not 0.5 <= distance / max(1, np.linalg.norm(older)) <= 2:
                        # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
                        continue
                # 현재 점까지 이어진 새 출발 경로 생성
                extended = path + [(timestamp_ms, *point)]
                # 충분한 연속 표본과 총 이동 거리를 갖춘 출발 경로인지 확인
                if len(extended) >= 4 and math.dist(extended[0][1:], point) >= 90:
                    # 관측된 출발 경로의 첫 원본 시각 읽음
                    first = extended[0][0]
                    # 영상 패턴만 전달하고 실제 중단·인플레이 입력 제외
                    # 실제 준비 프레임 보존으로 긴 준비의 관측 공백 오인 방지
                    preparation = sorted(
                        set([time for time in self.preparation_times if time < first] + [first])
                    )
                    # 실제 준비 관측 시각들을 재개 상태 전이 입력으로 구성
                    sequence = [
                        RestartObservation(
                            time,
                            continuity,
                            preparation_detected=True,
                            restart_candidates=("CORNER_KICK",),
                            evidence_ids=(f"frame:{time}",),
                        )
                        for time in preparation
                    ]
                    # 출발 움직임 관측을 준비 시퀀스 뒤에 연결
                    sequence.append(
                        RestartObservation(
                            timestamp_ms,
                            continuity,
                            departure_detected=True,
                            evidence_ids=(f"frame:{timestamp_ms}",),
                        )
                    )
                    # 본방·규정 사실을 확정하지 않는 화면 패턴 모드로 재개 관측 평가
                    result = setpieces(sequence, require_live_source=False, visual_pattern=True)
                    # 상태 전이가 준비에서 출발 관측까지 이어졌는지 확인
                    if not result or result[0].status != "OBSERVED":
                        # 기하 또는 경로 연결 조건에 맞지 않는 후보 제외
                        continue
                    # 같은 출발 패턴의 재출력을 막을 대기 구간 설정
                    self.cooldown_until = timestamp_ms + 5000
                    # 확인된 화면 출발 경로를 진단 근거로 보존
                    self.last_departure = extended
                    # 조건이 끊긴 출발 경로 후보를 다음 표본에 이어붙이지 않음
                    self.paths = []
                    # 적법한 코너킥 판정이 아닌 코너 출발 화면 패턴 반환
                    return {
                        "kind": "CORNER_KICK",
                        "status": "OBSERVED",
                        "startMs": self.prepared_at,
                        "endMs": timestamp_ms + 1,
                        "restartMs": first,
                        "evidenceTimestampsMs": sorted(
                            set([self.prepared_at] + [step[0] for step in extended])
                        ),
                        "method": "corner-geometry-motion-v1",
                    }
                # 아직 완료 조건에 못 미친 경로 분기 보존
                next_paths.append(extended)
        # 현재 이동 성분 중심을 기존 경로 또는 신규 경로에 연결
        for point in points:
            # 교점 가까운 높이와 거리에서 새 출발 경로를 시작할 수 있는지 확인
            if (
                math.dist(point, (self.geometry.x, self.geometry.y)) < 115
                and abs(point[1] - self.geometry.y) < 45
            ):
                # 코너 가까이에서 시작하는 새 이동 경로 생성
                next_paths.append([(timestamp_ms, *point)])
        # 분기 폭주 시 임의 경로 확정 대신 프레임 보류
        self.paths = next_paths if len(next_paths) <= 128 else []
        # 지원하는 화면 근거가 부족하여 코너 관측 결과 보류
        return None
