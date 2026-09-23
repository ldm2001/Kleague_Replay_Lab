from __future__ import annotations
import math
import cv2
import numpy as np
from ..domain.ball import BallCandidate
from .context import field, frameImage

# 잔디 주변에서 공 후보가 될 수 있는 작은 원형 물체를 검색
def ballCandidates(frame: np.ndarray) -> tuple[BallCandidate, ...]:
    """경기장·인접 공중의 작고 밝은 물체 탐색과 공 확정 제외"""
    # 공 후보 탐색에 사용할 분석 해상도 화면 생성
    image = frameImage(frame)
    # 녹색 범위로 잔디 후보 마스크 읽음
    grass, _ = field(image)
    # 잔디 후보가 너무 적어 경기장 주변 탐색이 어려운지 확인
    if np.count_nonzero(grass) / grass.size < 0.2:
        # 조건을 만족하는 탐색 영역이 없어 공 후보 목록을 비워 반환
        return ()
    # 녹색 로고·광고 제외를 위한 주 잔디 영역 사용
    count, components, stats, _ = cv2.connectedComponentsWithStats(grass, connectivity=8)
    # 배경을 제외한 연결된 잔디 영역 존재 여부 확인
    if count <= 1:
        # 조건을 만족하는 탐색 영역이 없어 공 후보 목록을 비워 반환
        return ()
    # 배경을 제외하고 가장 넓은 잔디색 연결 영역 선택
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    # 주 잔디 영역만 남긴 이진 탐색 마스크 생성
    grass = np.where(components == largest, 255, 0).astype(np.uint8)
    # 떠 있는 공은 잔디와 붙어 있지 않을 수 있어 수직 탐색 띠를 넓힌다
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # 공처럼 밝고 채도가 낮은 픽셀 범위 추출
    bright = cv2.inRange(hsv, (0, 0, 160), (179, 65, 255))
    # 공중 공을 놓치지 않기 위한 세로 탐색 여유 계산
    margin = max(12, round(image.shape[0] * 0.15))
    # 잔디 영역의 위아래를 넓혀 인접 공중까지 탐색 범위 확장
    search_area = cv2.dilate(grass, np.ones((2 * margin + 1, 9), dtype=np.uint8))
    # 잔디 주변 탐색 영역 안의 밝은 픽셀만 유지
    white = cv2.bitwise_and(bright, search_area)
    # 작고 밝은 물체의 외곽 윤곽선 탐색
    contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # 윤곽선 경계 검사용 분석 화면 크기 읽음
    height, width = grass.shape
    # 아직 공으로 확정하지 않은 화면 물체 후보 목록 생성
    candidates: list[BallCandidate] = []
    # 각 밝은 물체가 크기·모양 조건을 만족하는지 검사
    for contour in contours:
        # 물체 윤곽선을 감싸는 사각형의 위치와 크기 계산
        x, y, w, h = cv2.boundingRect(contour)
    # 잘린 화면 가장자리·긴 선분의 안정적 중심 추적 불가
        if min(w, h) < 3 or max(w, h) > 18 or not 0.55 <= w / h <= 1.8:
            # 공 후보 탐색 기준을 벗어난 물체 제외
            continue
        # 화면 밖으로 잘려 중심을 안정적으로 구할 수 없는 물체인지 확인
        if x == 0 or y == 0 or x + w >= width or y + h >= height:
            # 공 후보 탐색 기준을 벗어난 물체 제외
            continue
        # 윤곽선 내부의 화면 면적 계산
        area = cv2.contourArea(contour)
        # 닫힌 윤곽선의 둘레 길이 계산
        perimeter = cv2.arcLength(contour, True)
        # 면적과 둘레 비율로 물체의 원형 정도 계산
        circularity = 4 * math.pi * area / (perimeter * perimeter) if perimeter else 0
        # 너무 작은 잡음 또는 원형성이 낮은 물체인지 확인
        if area < 5 or circularity < 0.55:
            # 공 후보 탐색 기준을 벗어난 물체 제외
            continue
        # 물체 사각형 주변이 경기장 탐색 범위에 포함되는지 볼 영역 추출
        neighborhood = search_area[
            max(0, y - 4) : min(height, y + h + 4), max(0, x - 4) : min(width, x + w + 4)
        ]
        # 물체 주변의 탐색 가능 영역 비율이 부족한지 확인
        if np.count_nonzero(neighborhood) / neighborhood.size < 0.35:
            # 공 후보 탐색 기준을 벗어난 물체 제외
            continue
        # 물체 윤곽을 감싸는 원의 중심과 반지름 계산
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        # 화면 중심·반지름·원형성을 공 미확정 후보로 보존
        candidates.append(
            BallCandidate(
                round(cx, 4), round(cy, 4), round(radius, 4), round(min(1, circularity), 6)
            )
        )
    # 화면 좌표 순서로 정렬한 밝은 원형 물체 후보 반환
    return tuple(sorted(candidates, key=lambda point: (point.x, point.y)))
