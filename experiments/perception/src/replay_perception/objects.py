# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import hypot
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 색상과 선분 및 미리보기를 다룰 영상 처리 도구 읽음
import cv2
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 영상 읽기 관련 함수와 자료형 읽음
from .media import timestamp
# 관측 목록 관련 함수와 자료형 읽음
from .observations import PoseObservation, RoleHypothesis
# 프레임 목록 관련 함수와 자료형 읽음
from .frames import RecordedFrame
# 동작 신호 관련 함수와 자료형 읽음
from .signals import armObservations


# 방법을 지정 문자열 값으로 설정
METHOD = "hand-object-pitch-context-v1"
# 개발 기준이며 보정된 확률이나 승인된 인식 방법 아님
MIN_SUPPORT = 3
# 최솟값 지속 시간 밀리초를 200 값으로 설정
MIN_DURATION_MS = 200
# 관측 연결을 허용할 공백 상한 밀리초를 250 값으로 설정
MAX_GAP_MS = 250

# 입력이 유효한 삼원색 영상인지 확인하고 세로·가로 크기를 반환
def image(rgb: np.ndarray) -> tuple[int, int]:
    # 심판 후보 영상의 자료 형식과 허용 조건 확인
    if (
        not isinstance(rgb, np.ndarray)
        or rgb.dtype != np.uint8
        or rgb.ndim != 3
        or rgb.shape[2] != 3
        or min(rgb.shape[:2]) <= 0
    ):
        # 심판 후보 영상 유효하지 않음 오류 알림
        raise ValueError("OFFICIAL_IMAGE_INVALID")
    # 삼원색 영상의 배열 크기의 선택 항목 반환
    return rgb.shape[:2]

# 지정한 중심과 반경의 영상 패치를 경계 안에서 추출
def imagePatch(rgb: np.ndarray, x: float, y: float, radius: float):
    # 영상 배열의 세로 크기와 가로 크기를 읽음
    height, width = rgb.shape[:2]
    # 주변 조각의 시작 좌표를 영 이상으로 제한
    x1, y1 = max(0, int(x - radius)), max(0, int(y - radius))
    # 주변 조각의 끝 좌표를 영상 너비와 높이 이내로 제한
    x2, y2 = min(width, int(x + radius) + 1), min(height, int(y + radius) + 1)
    # 선택한 영상 조각과 원본 좌표로 돌아가기 위한 가로·세로 원점 반환
    return rgb[y1:y2, x1:x2], x1, y1

# 한 점과 직사각형 경계 사이의 최소 거리를 계산
def rectangleDistance(x: float, y: float, box) -> float:
    # 여러 값을 순서대로 모은 자료에 원본 화면의 시작점과 끝점 상자 좌표 저장
    x1, y1, x2, y2 = box
    # 직각 성분으로 구한 거리 반환
    return hypot(max(x1 - x, 0, x - x2), max(y1 - y, 0, y - y2))

# 손 주변 패치에서 깃대 후보가 될 수 있는 선분을 검색
def shaftLines(patch, body_height: float) -> np.ndarray:
    # 윤곽선에 밝기 변화로 찾은 윤곽선 저장
    edges = cv2.Canny(cv2.cvtColor(patch, cv2.COLOR_RGB2GRAY), 40, 100)
    # 하한에 6의 최댓값 저장
    minimum = max(6, int(.07 * body_height))
    # 줄 목록에 영상에서 찾은 선분 후보 저장
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=minimum,
        minLineLength=minimum,
        maxLineGap=max(2, int(0.02 * body_height)),
    )
    # 조건에 따라 선택한 빈 자료 처리 결과 반환
    return np.empty((0, 1, 4), dtype=np.int32) if lines is None else lines

# 선분의 길이와 손목·물체 위치가 깃대 형태에 맞는지 확인
def shaftMatch(lines, wrist, box, body_height: float) -> bool:
    # 허용 거리에 4점0의 최댓값 저장
    tolerance = max(4., .04 * body_height)
    # 줄 목록의 선택 항목에서 여러 값을 순서대로 모은 자료를 하나씩 읽음
    for x1, y1, x2, y2 in lines[:, 0]:
        # 시작 가로 좌표·시작 세로 좌표·끝 가로 좌표·끝 세로 좌표·끝 가로 좌표·끝 세로 좌표·시작 가로 좌표·시작 세로 좌표에서 첫 번째·마지막을 하나씩 읽음
        for first, last in (((x1, y1), (x2, y2)), ((x2, y2), (x1, y1))):
            # 직각 성분으로 구한 거리 및 허용 거리의 이하 조건 및 사각형 거리 처리 결과 및 3점0의 최댓값의 이상 조건 및 사각형 거리 처리 결과 및 허용 거리의 이하 조건 확인
            if (
                hypot(first[0] - wrist[0], first[1] - wrist[1]) <= tolerance
                and rectangleDistance(*first, box) >= max(3.0, 0.025 * body_height)
                and rectangleDistance(*last, box) <= tolerance
            ):
                # 참 반환
                return True
    # 거짓 반환
    return False

# 손 주변의 색과 형태를 측정해 물체 모양의 단서를 반환
def heldObjects(rgb: np.ndarray, pose: PoseObservation) -> tuple[dict[str, Any], ...]:
    # 영상 배열의 세로 크기와 가로 크기를 읽음
    height, width = image(rgb)
    # 원본 검출 상자의 아래쪽과 위쪽 세로 좌표 차이로 화면상 신체 높이 계산
    body_height = pose.source_box[3] - pose.source_box[1]
    # 출력을 모를 빈 자료 생성
    output = []
    # 왼쪽·5·7·9·오른쪽·6·8·10에서 방향·순번 목록을 하나씩 읽음
    for side, indices in (("LEFT", (5, 7, 9)), ("RIGHT", (6, 8, 10))):
        # 어깨·팔꿈치·손목에 순번 목록의 항목별 변환 결과 저장
        shoulder, elbow, wrist = (pose.keypoints[index] for index in indices)
        # 기준을 다음 항목으로 구성
        base = {
            # 방향 필드 기록
            "side": side,
            # 종류를 미승인 또는 미확인 상태로 보존
            "kind": "UNKNOWN",
            # 상태 필드 기록
            "state": "UNOBSERVABLE",
            # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
            "admission": "NOT_ADMITTED",
            # 방법 필드 기록
            "method": METHOD,
            # 관절점 순번 목록 필드 기록
            "keypointIndices": list(indices),
        }
        # 신체 높이 및 64의 미만 조건 또는 어깨·팔꿈치·손목의 항목별 변환 결과의 하나 이상 조건 충족 여부 또는 어깨·팔꿈치·손목의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
        if (
            body_height < 64
            or any(point.score < 0.5 for point in (shoulder, elbow, wrist))
            or any(
                not (0 <= point.x < width and 0 <= point.y < height)
                for point in (shoulder, elbow, wrist)
            )
        ):
            # 출력에 필드별로 묶은 기록 추가
            output.append({**base, "reason": "HAND_GEOMETRY_UNOBSERVABLE"})
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 직각 성분으로 구한 거리 및 4의 미만 조건 확인
        if hypot(wrist.x - elbow.x, wrist.y - elbow.y) < 4:
            # 출력에 필드별로 묶은 기록 추가
            output.append({**base, "reason": "FOREARM_TOO_SHORT"})
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 상의·하의에서 카드 색상 픽셀 탐색 금지
        if wrist.y >= shoulder.y:
            # 출력에 필드별로 묶은 기록 추가
            output.append({**base, "reason": "HAND_NOT_ABOVE_SHOULDER"})
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 주변 영상 조각·조각 가로 원점·조각 세로 원점에 영상 주변 영상 조각 처리 결과 저장
        patch, ox, oy = imagePatch(rgb, wrist.x, wrist.y, min(192., .6 * body_height))
        # 색상 채도 명도 영상에 색상 표현을 변환한 영상 저장
        hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
        # 색상 마스크 목록을 다음 항목으로 구성
        masks = {
            # 노란색 필드 기록
            "YELLOW": cv2.inRange(hsv, (18, 100, 100), (38, 255, 255)),
            # 빨간색 필드 기록
            "RED": cv2.bitwise_or(
                cv2.inRange(hsv, (0, 120, 90), (10, 255, 255)),
                cv2.inRange(hsv, (170, 120, 90), (179, 255, 255)),
            ),
        }
        # 후보 목록을 모를 빈 자료 생성
        candidates = []
        # 줄 목록을 아직 없는 상태로 초기화
        lines = None
        # 키와 값의 쌍 목록에서 색상·색상 마스크를 하나씩 읽음
        for colour, mask in masks.items():
            # 여러 값을 순서대로 모은 자료에 붙어 있는 색상 영역과 통계 저장
            count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
            # 연결 영역 통계의 선택 항목에서 여러 값을 순서대로 모은 자료를 하나씩 읽음
            for x, y, w, h, area in stats[1:count]:
                # 면적 및 8의 미만 조건 또는 너비의 최솟값 및 3의 미만 조건 확인
                if area < 8 or min(w, h) < 3:
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 원본 화면의 시작점과 끝점 상자 좌표를 다음 항목으로 구성
                box = (int(x + ox), int(y + oy), int(x + ox + w), int(y + oy + h))
                # 거리에 사각형 거리 처리 결과 저장
                distance = rectangleDistance(wrist.x, wrist.y, box)
                # 색상 영역 상자의 긴 변과 짧은 변 길이 계산
                long_side, short_side = float(max(w, h)), float(min(w, h))
                # 색상 화소 수를 감싸는 사각형 면적으로 나누어 채움 비율 계산
                fill = float(area) / float(w * h)
                # 긴 변을 짧은 변으로 나누어 물체 모양 비교용 종횡비 계산
                ratio = long_side / short_side
                # 원본 화면의 시작점과 끝점 상자 좌표의 선택 항목 및 세로 좌표의 초과 조건 또는 거리 및 수치 연산 결과의 초과 조건 확인
                if box[3] > shoulder.y or distance > .35 * body_height:
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 색상 덩어리의 크기와 비율로 깃발 모양 가능성만 계산
                possible_flag = (
                    0.10 * body_height <= long_side <= 0.5 * body_height
                    and 1 <= ratio <= 5
                    and fill >= 0.35
                )
                # 손목 거리와 사각형 채움 비율로 카드 모양 가능성만 계산
                possible_card = (
                    0.02 * body_height <= long_side <= 0.14 * body_height
                    and 1.15 <= ratio <= 2.4
                    and fill >= 0.70
                    and distance <= 0.05 * body_height
                )
                # 부정 조건 가능한 깃발 및 부정 조건 가능한 카드 확인
                if not possible_flag and not possible_card:
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 줄 목록이 없는지 확인
                if lines is None:
                    # 줄 목록에 깃대 후보 줄 목록 처리 결과 저장
                    lines = shaftLines(patch, body_height)
                # 깃대 후보에 깃대 후보 대응 처리 결과 저장
                shaft = shaftMatch(
                    lines,
                    (wrist.x - ox, wrist.y - oy),
                    (int(x), int(y), int(x + w), int(y + h)),
                    body_height,
                )
                # 종류를 확인 불가 값으로 설정
                kind = "UNKNOWN"
                # 가능한 깃발 및 깃대 후보 확인
                if possible_flag and shaft:
                    # 종류를 깃발 모양 후보 값으로 설정
                    kind = "FLAG_LIKE"
                # 가능한 카드 및 부정 조건 깃대 후보 확인
                elif possible_card and not shaft:
                    # 종류에 현재 값을 포함한 문자열 저장
                    kind = f"{colour}_CARD_LIKE"
                # 종류 및 확인 불가의 불일치 조건 확인
                if kind != "UNKNOWN":
                    # 후보 목록에 필드별로 묶은 기록 추가
                    candidates.append(
                        {
                            **base,
                            # 종류 필드 기록
                            "kind": kind,
                            # 상태 필드 기록
                            "state": "CUE",
                            # 색상 필드 기록
                            "colour": colour,
                            # 객체 상자 필드 기록
                            "objectBox": list(box),
                            # 화소 면적 필드 기록
                            "pixelArea": int(area),
                            # 사각형 채움 비율 필드 기록
                            "rectangleFill": fill,
                            # 종횡 비율 필드 기록
                            "aspectRatio": ratio,
                            # 손목 거리 화소 단위 필드 기록
                            "wristDistancePx": distance,
                            # 깃대 후보 지지 관측 필드 기록
                            "shaftSupport": shaft,
                            # 사유 필드 기록
                            "reason": "COLOUR_GEOMETRY_ONLY",
                        }
                    )
        # 후보 목록의 항목 수 및 1의 일치 조건 확인
        if len(candidates) == 1:
            # 출력에 후보 목록의 선택 항목 추가
            output.append(candidates[0])
        # 앞선 분기에 해당하지 않는 경우 처리
        else:
            # 출력에 필드별로 묶은 기록 추가
            output.append(
                {
                    **base,
                    # 상태를 미승인 또는 미확인 상태로 보존
                    "state": "UNKNOWN",
                    # 사유 필드 기록
                    "reason": "MULTIPLE_HAND_PATCHES" if candidates else "NO_SUPPORTED_HAND_PATCH",
                }
            )
    # 출력의 순서를 고정한 튜플 변환 결과 반환
    return tuple(output)

# 관절 주변의 잔디와 경계선을 이용해 화면상의 경기장 맥락을 측정
def pitchContext(rgb: np.ndarray, pose: PoseObservation) -> dict[str, Any]:
    # 영상 배열의 세로 크기와 가로 크기를 읽음
    height, width = image(rgb)
    # 발목 목록을 다음 항목으로 구성
    ankles = (pose.keypoints[15], pose.keypoints[16])
    # 발목 목록의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
    if any(
        point.score < 0.5 or not (0 <= point.x < width and 0 <= point.y < height)
        for point in ankles
    ):
        # 필드별로 묶은 기록 반환
        return {"state": "UNKNOWN", "reason": "FEET_UNOBSERVABLE"}
    # 원본 검출 상자의 아래쪽과 위쪽 세로 좌표 차이로 화면상 신체 높이 계산
    body_height = pose.source_box[3] - pose.source_box[1]
    # 신체 높이 및 64의 미만 조건 확인
    if body_height < 64:
        # 필드별로 묶은 기록 반환
        return {"state": "UNKNOWN", "reason": "PERSON_TOO_SMALL"}
    # 양 발목 좌표의 평균으로 화면상 발 기준점 계산
    foot_x, foot_y = sum(point.x for point in ankles) / 2, sum(point.y for point in ankles) / 2
    # 주변 영상 조각·조각 가로 원점·조각 세로 원점에 영상 주변 영상 조각 처리 결과 저장
    patch, ox, oy = imagePatch(rgb, foot_x, foot_y, min(256., .65 * body_height))
    # 색상 채도 명도 영상에 색상 표현을 변환한 영상 저장
    hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
    # 잔디색 영역에 지정 색상 범위에 속하는 화소 마스크 및 0의 초과 조건 저장
    grass = cv2.inRange(hsv, (30, 45, 35), (85, 255, 255)) > 0
    # 흰색 영역에 지정 색상 범위에 속하는 화소 마스크 저장
    white = cv2.inRange(hsv, (0, 0, 155), (179, 65, 255))
    # 하한에 20의 최댓값 저장
    minimum = max(20, int(.4 * body_height))
    # 줄 목록에 영상에서 찾은 선분 후보 저장
    lines = cv2.HoughLinesP(
        white,
        1,
        np.pi / 180,
        threshold=max(15, minimum // 2),
        minLineLength=minimum,
        maxLineGap=max(4, int(0.04 * body_height)),
    )
    # 세로 좌표 격자·가로 좌표 격자에 순번 목록 처리 결과 저장
    yy, xx = np.indices(grass.shape)
    # 반경에 직각 성분으로 구한 거리 저장
    radius = np.hypot(xx - (foot_x - ox), yy - (foot_y - oy))
    # 발 중심에 너무 가깝거나 먼 화소를 제외한 고리 영역 선택
    ring = (radius >= .12 * body_height) & (radius <= .5 * body_height)
    # 고리 영역의 잔디색 비율을 구하고 유효 화소가 없으면 영으로 설정
    local_ratio = float(grass[ring].mean()) if ring.any() else 0.
    # 줄 목록이 있는지 확인
    if lines is not None:
        # 줄 목록의 선택 항목에서 여러 값을 순서대로 모은 자료를 하나씩 읽음
        for x1, y1, x2, y2 in lines[:64, 0]:
            # 길이에 직각 성분으로 구한 거리 저장
            length = hypot(float(x2 - x1), float(y2 - y1))
            # 선분 기준으로 화소가 어느 쪽에 있는지 나타내는 부호 있는 거리 계산
            signed = ((xx - x1) * (y2 - y1) - (yy - y1) * (x2 - x1)) / length
            # 발 거리에 수치 연산 결과 및 길이의 비율의 절댓값 저장
            foot_distance = abs(
                ((foot_x - ox - x1) * (y2 - y1) - (foot_y - oy - y1) * (x2 - x1)) / length
            )
            # 발 거리 및 0점25 및 신체 높이의 곱의 초과 조건 확인
            if foot_distance > .25 * body_height:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 첫 번째에 부호 있는 거리 및 수치 연산 결과의 초과 조건 및 부호 있는 거리 및 수치 연산 결과의 미만 조건의 공통 영역 저장
            first = (signed > .04 * body_height) & (signed < .25 * body_height)
            # 두 번째에 부호 있는 거리 및 수치 연산 결과의 미만 조건 및 부호 있는 거리 및 수치 연산 결과의 초과 조건의 공통 영역 저장
            second = (signed < -.04 * body_height) & (signed > -.25 * body_height)
            # 합계의 정수 변환 결과의 최솟값 및 30의 미만 조건 확인
            if min(int(first.sum()), int(second.sum())) < 30:
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 비율 목록을 다음 항목으로 구성
            ratios = float(grass[first].mean()), float(grass[second].mean())
            # 경계선 양쪽 잔디색 비율의 차이 계산
            contrast = abs(ratios[0] - ratios[1])
            # 비율 목록의 최댓값 및 0점55의 이상 조건 및 비율 목록의 최솟값 및 0점35의 이하 조건 및 차이 및 0점35의 이상 조건 확인
            if max(ratios) >= .55 and min(ratios) <= .35 and contrast >= .35:
                # 필드별로 묶은 기록 반환
                return {
                    # 상태 필드 기록
                    "state": "NEAR_PITCH_BOUNDARY",
                    # 잔디색 영역 방향 차이 필드 기록
                    "grassSideContrast": contrast,
                    # 잔디색 영역 방향 비율 목록 필드 기록
                    "grassSideRatios": list(ratios),
                    # 발 줄 거리 화소 단위 필드 기록
                    "footLineDistancePx": foot_distance,
                    # 줄 필드 기록
                    "line": [int(x1 + ox), int(y1 + oy), int(x2 + ox), int(y2 + oy)],
                    # 사유 필드 기록
                    "reason": "WHITE_LINE_AND_OPPOSING_GROUND_CONTEXT",
                }
    # 필드별로 묶은 기록 반환
    return {
        # 상태 필드 기록
        "state": "IN_PITCH_CONTEXT" if local_ratio >= 0.75 else "UNKNOWN",
        # 주변 잔디색 영역 비율 필드 기록
        "localGrassRatio": local_ratio,
        # 사유 필드 기록
        "reason": "LOCAL_GROUND_CONTEXT_ONLY",
    }


# 지지 관측의 필드와 동작을 묶을 자료형 선언
@dataclass(slots=True)
class _Support:
    # 시작 밀리초를 보관할 자료형 선언
    start_ms: int
    # 시작 시간을 보관할 자료형 선언
    start_time: Fraction
    # 마지막 시간을 보관할 자료형 선언
    last_time: Fraction
    # 수량을 보관할 자료형 선언
    count: int


# 심판 후보 관측기의 필드와 동작을 묶을 자료형 선언
class OfficialObserver:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 활성을 모를 빈 자료 생성
        self._active: dict[tuple, _Support] = {}
        # 마지막 밀리초를 아직 없는 상태로 초기화
        self._last_ms: int | None = None
        # 원본을 아직 없는 상태로 초기화
        self._source = None

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        frame: RecordedFrame,
        roles: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
    ) -> tuple[dict[str, Any], ...]:
        # 표본에 프레임의 표본 저장
        sample = frame.sample
        # 밀리초에 표본의 원본 시작점 기준 밀리초 저장
        ms = sample.timestamp_ms
        # 원본 시작점 기준 경과 시간에 원본 표시 시각 눈금 및 눈금당 초 단위 시간의 곱 및 시작점 표시 시각 눈금 및 시작점 눈금당 초 단위 시간의 곱의 차이 저장
        relative_time = sample.pts * sample.time_base - sample.origin_pts * sample.origin_time_base
        # 프레임 시각 표시 시각 눈금 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if ms != timestamp(
            sample.pts, sample.time_base, sample.origin_pts, sample.origin_time_base
        ):
            # 프레임 시각 표시 시각 눈금 불일치 오류 알림
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        # 동일성 정보를 다음 항목으로 구성
        identity = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        # 원본 범위 변경을 감지해 잘못된 입력의 후속 사용 차단
        if self._source is not None and identity != self._source:
            # 원본 범위 변경 오류 알림
            raise ValueError("SOURCE_SCOPE_CHANGED")
        # 시간축 아닌 시간순을 감지해 잘못된 입력의 후속 사용 차단
        if self._last_ms is not None and ms <= self._last_ms:
            # 시간축 아닌 시간순 오류 알림
            raise ValueError("TIMELINE_NON_MONOTONIC")
        # 검출 목록에 프레임의 검출 목록의 항목별 변환 결과 저장
        detections = {item.detection_id: item for item in frame.detections}
        # 기준 역할에 역할 목록의 항목별 변환 결과 저장
        by_role = {item.detection_id: item for item in roles}
        # 검출 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(detections) != len(frame.detections) or len(by_role) != len(roles):
            # 검출 식별자 중복 오류 알림
            raise ValueError("DETECTION_ID_DUPLICATE")
        # 역할 식별자 목록에 역할 목록에서 조건에 맞는 항목을 모은 값 저장
        role_ids = [item.role_detection_id for item in roles if item.status == "MATCHED"]
        # 역할 연결 모호한을 감지해 잘못된 입력의 후속 사용 차단
        if len(role_ids) != len(set(role_ids)):
            # 역할 연결 모호한 오류 알림
            raise ValueError("ROLE_ASSOCIATION_AMBIGUOUS")
        # 추적 목록에 프레임의 검출 목록에서 조건에 맞는 항목을 모은 값 저장
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        # 추적 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len(set(tracks)) != len(tracks):
            # 추적 식별자 중복 오류 알림
            raise ValueError("TRACK_ID_DUPLICATE")
        # 자세 식별자 중복을 감지해 잘못된 입력의 후속 사용 차단
        if len({item.detection_id for item in poses}) != len(poses):
            # 자세 식별자 중복 오류 알림
            raise ValueError("POSE_ID_DUPLICATE")
        # 자세 목록에서 자세를 하나씩 읽음
        for pose in poses:
            # 검출에 자세의 검출 식별자의 키에 해당하는 값 저장
            detection = detections.get(pose.detection_id)
            # 자세 원본 불일치를 감지해 잘못된 입력의 후속 사용 차단
            if detection is None or detection.label != "person" or detection.box != pose.source_box:
                # 자세 원본 불일치 오류 알림
                raise ValueError("POSE_SOURCE_MISMATCH")
        # 출력·현재를 다음 항목으로 구성
        output, current = [], {}
        # 자세 목록에서 자세를 하나씩 읽음
        for pose in poses:
            # 검출에 검출 목록의 선택 항목 저장
            detection = detections[pose.detection_id]
            # 역할에 자세의 검출 식별자의 키에 해당하는 값 저장
            role = by_role.get(pose.detection_id)
            # 객체 목록에 손 주변 객체 목록 처리 결과 저장
            objects = heldObjects(sample.rgb, pose)
            # 맥락에 경기장 맥락 처리 결과 저장
            context = pitchContext(sample.rgb, pose)
            # 팔 목록에 판정 의미를 부여하지 않은 양팔 기하 관측 저장
            arms = armObservations(pose, sample.rgb.shape[1], sample.rgb.shape[0])
            # 종류 목록에 객체 목록에서 조건에 맞는 항목을 모은 값 저장
            kinds = {item["kind"] for item in objects if item["kind"] != "UNKNOWN"}
            # 신호 단서에 조건에 따라 선택한 다음 항목 저장
            signal = next(iter(kinds)) if len(kinds) == 1 else "UNKNOWN"
            # 방향 목록에 객체 목록에서 조건에 맞는 항목을 모은 값 저장
            sides = [
                item["side"] for item in objects if item["kind"] == signal and signal != "UNKNOWN"
            ]
            # 부정 조건 종류 목록 및 팔 목록의 항목별 변환 결과의 하나 이상 조건 충족 여부 확인
            if not kinds and any(arm["state"] == "ARM_RAISED" for arm in arms):
                # 신호 단서를 팔 올림 조건 충족 팔 값으로 설정
                signal = "RAISED_ARM"
                # 방향 목록에 팔 목록에서 조건에 맞는 항목을 모은 값 저장
                sides = [arm["side"] for arm in arms if arm["state"] == "ARM_RAISED"]
            # 신호 단서 방향에 조건에 따라 선택한 결합 처리 결과 저장
            signal_side = "+".join(sorted(sides)) if sides else "UNKNOWN"
            # 심판 역할 가설과 추적 번호 및 손동작 단서가 함께 있는지 확인
            supported = (
                role is not None
                and role.status == "MATCHED"
                and role.role == "referee"
                and detection.track_id is not None
                and signal != "UNKNOWN"
            )
            # 키를 다음 항목으로 구성
            key = (frame.continuity_id, detection.track_id, signal, signal_side, context["state"])
            # 이전에 조건에 따라 선택한 키의 키에 해당하는 값 저장
            previous = self._active.get(key) if supported else None
            # 지지 관측에 지지 관측 처리 결과 저장
            support = _Support(ms, relative_time, relative_time, 1)
            # 이전이 있는지 및 수치 연산 결과 및 반올림 없는 유리수의 이하 조건 확인
            if previous is not None and relative_time - previous.last_time <= Fraction(
                MAX_GAP_MS, 1000
            ):
                # 지지 관측에 지지 관측 처리 결과 저장
                support = _Support(
                    previous.start_ms, previous.start_time, relative_time, previous.count + 1
                )
            # 관측 지지 여부 확인
            if supported:
                # 현재의 선택 항목에 지지 관측 저장
                current[key] = support
            # 최소 관측 수와 지속 시간을 만족하는 신호 단서인지 확인
            sustained = (
                supported
                and support.count >= MIN_SUPPORT
                and relative_time - support.start_time >= Fraction(MIN_DURATION_MS, 1000)
            )
            # 독립된 의미 검증이 없는 심판 세부 역할을 확인 불가로 초기화
            official_role = "UNKNOWN"
            # 연속 지지 조건 충족 및 신호 단서 및 깃발 모양 후보의 일치 조건 및 맥락의 상태 및 주변 경기장 경계의 일치 조건 확인
            if sustained and signal == "FLAG_LIKE" and context["state"] == "NEAR_PITCH_BOUNDARY":
                # 지속된 깃발 모양과 경기장 경계 맥락을 부심 후보로만 기록
                official_role = "ASSISTANT_CANDIDATE"
            # 연속 지지 조건 충족 및 신호 단서 및 깃발 모양 후보의 불일치 조건 및 맥락의 상태 및 내부 경기장 맥락의 일치 조건 확인
            elif sustained and signal != "FLAG_LIKE" and context["state"] == "IN_PITCH_CONTEXT":
                # 지속된 손동작과 경기장 내부 맥락을 주심 후보로만 기록
                official_role = "MAIN_CANDIDATE"
            # 발목 목록을 다음 항목으로 구성
            ankles = (pose.keypoints[15], pose.keypoints[16])
            # 발 목록 화면 내 관측 가능에 발목 목록의 항목별 변환 결과의 전체 조건 충족 여부 저장
            feet_visible = all(
                point.score >= 0.5
                and 0 <= point.x < sample.rgb.shape[1]
                and 0 <= point.y < sample.rgb.shape[0]
                for point in ankles
            )
            # 발 점에 조건에 따라 선택한 수치 연산 결과·수치 연산 결과 저장
            foot_point = (
                [sum(point.x for point in ankles) / 2, sum(point.y for point in ankles) / 2]
                if feet_visible
                # 앞선 분기에 해당하지 않는 경우 처리
                else None
            )
            # 출력에 필드별로 묶은 기록 추가
            output.append(
                {
                    # 검출 식별자 필드 기록
                    "detectionId": pose.detection_id,
                    # 구간 안에서만 유효한 추적 식별자 필드 기록
                    "trackId": detection.track_id,
                    # 연속 구간 식별자 필드 기록
                    "continuityId": frame.continuity_id,
                    # 시각 밀리초 필드 기록
                    "timestampMs": ms,
                    # 시작 밀리초 필드 기록
                    "startMs": support.start_ms,
                    # 지지 관측 프레임 수량 필드 기록
                    "supportFrameCount": support.count if supported else 0,
                    # 확정 사실이 아닌 역할 가설 필드 기록
                    "roleHypothesis": role.as_record() if role is not None else None,
                    # 객체 목록 필드 기록
                    "objects": list(objects),
                    # 경기장 맥락 필드 기록
                    "pitchContext": context,
                    # 팔 목록 필드 기록
                    "arms": list(arms),
                    # 신호 단서 종류 필드 기록
                    "signalKind": signal,
                    # 신호 단서 방향 필드 기록
                    "signalSide": signal_side,
                    # 연속 지지 조건 충족 필드 기록
                    "sustained": bool(sustained),
                    # 심판 후보 역할 필드 기록
                    "officialRole": official_role,
                    # 선언된 원심의 확인 상태를 미승인 또는 미확인 상태로 보존
                    "originalDecision": "UNKNOWN",
                    # 발 점 필드 기록
                    "footPoint": foot_point,
                    # 사람 높이 화소 단위 필드 기록
                    "personHeightPx": pose.source_box[3] - pose.source_box[1],
                    # 마지막 프레임 필드 기록
                    "lastFrame": sample.as_record(),
                    # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
                    "admission": "NOT_ADMITTED",
                    # 방법 필드 기록
                    "method": METHOD,
                    # 사유 필드 기록
                    "reason": "ROLE_AND_OBJECT_METHOD_UNVALIDATED",
                }
            )
        # 활성·마지막 밀리초·원본을 다음 항목으로 구성
        self._active, self._last_ms, self._source = current, ms, identity
        # 출력의 순서를 고정한 튜플 변환 결과 반환
        return tuple(output)
