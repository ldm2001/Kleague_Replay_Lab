"""학습 모델 없는 좌상단 쿠팡형 득점 방송 표시 인식

해당 16:9 방송 배치만 지원
흰 글자의 연결 구조·형태와 빨강·파랑 띠 및 남색 시계 띠의 일치 요구
애니메이션·가림·다른 배치의 누락 가능
임의 문구 인식이나 득점 인정·득점자·비디오 판독·축구 판정의 근거 아님
기준 글자는 영상 복사 없이 도형 라이브러리로 생성"""

from functools import lru_cache
import cv2
import numpy as np

# 글자 마스크를 템플릿 비교에 사용할 크기로 맞춘다
def normalizedMask(mask: np.ndarray) -> np.ndarray:
    # 글자 마스크에서 실제 잉크 픽셀 위치 탐색
    points = cv2.findNonZero(mask)
    # 비교할 흰색 글자 성분 존재 여부 확인
    if points is None:
        # 글자 성분이 없으면 비어 있는 표준 크기 마스크 반환
        return np.zeros((32, 32), dtype=bool)
    # 글자 픽셀만 감싸는 최소 사각형 계산
    x, y, width, height = cv2.boundingRect(points)
    # 글자 바깥 여백을 제거하고 표준 이진 마스크로 변환해 반환
    return (
        cv2.resize(mask[y : y + height, x : x + width], (32, 32), interpolation=cv2.INTER_AREA)
        >= 128
    )

# 지정한 글자의 크기·두께별 고정 형태 템플릿을 생성
@lru_cache(maxsize=8)
def templates(letter: str) -> tuple[np.ndarray, ...]:
    # 허용한 글꼴·두께의 고정 글자 모양 목록 생성
    masks = []
    # 외부 문자 모델 없이 지원하는 두 고정 도형 글꼴 순회
    for font in (cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX):
        # 방송 표시 굵기 변화에 대응할 획 두께 순회
        for thickness in (2, 3, 4, 5, 6):
            # 합성 글자 도형을 그릴 빈 화면 생성
            mask = np.zeros((60, 60), dtype=np.uint8)
            # 지정한 문자 도형을 현재 글꼴과 두께로 생성
            cv2.putText(mask, letter, (5, 45), font, 1.5, 255, thickness, cv2.LINE_AA)
            # 합성 글자 도형을 공통 비교 크기로 정규화하여 보존
            masks.append(normalizedMask(mask))
    # 입력 문자에 해당하는 고정 모양 템플릿 묶음 반환
    return tuple(masks)

# 글자 마스크의 외곽과 내부 공간을 고정 템플릿과 비교
def glyphMatch(mask: np.ndarray, letter: str) -> bool:
    # 관측한 글자 후보를 템플릿과 같은 크기로 정규화
    normalized = normalizedMask(mask)
    # 글자 후보에 실제 획이 있는지 확인
    if not normalized.any():
        # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
        return False
    # 글자 내부 구멍과 외부 배경을 구분할 여백 추가
    padded = cv2.copyMakeBorder(normalized.astype(np.uint8), 1, 1, 1, 1, cv2.BORDER_CONSTANT)
    # 반전된 글자 영상에서 배경과 내부 빈 공간의 연결 성분 계산
    count, _, stats, centers = cv2.connectedComponentsWithStats(1 - padded)
    # 배경을 제외한 글자 내부 빈 공간의 면적과 중심 수집
    holes = [(stat[cv2.CC_STAT_AREA], center) for stat, center in zip(stats[2:], centers[2:])]
    # 미세한 틈을 제외하고 의미 있는 내부 빈 공간 선택
    large_holes = [(area, center) for area, center in holes if area >= 12]
    # 내부 빈 공간 하나를 요구하는 원형·삼각형 글자 조건 분기
    if letter in "OA":
        # 해당 글자에 필요한 내부 빈 공간이 정확히 하나인지 확인
        if len(large_holes) != 1:
            # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
            return False
        # 글자 내부 빈 공간의 면적과 위치 읽음
        area, center = large_holes[0]
        # 원형 글자의 내부 공간이 충분히 크고 중앙에 있는지 확인
        if letter == "O" and not (area >= 85 and 11 <= center[1] <= 22):
            # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
            return False
        # 삼각형 글자의 내부 공간이 위쪽에 있고 과도하게 크지 않은지 확인
        if letter == "A" and not (center[1] < 20 and area < 360):
            # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
            return False
    # 내부 구멍이 없어야 하는 글자에 큰 빈 공간이 있는지 확인
    elif large_holes:
        # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
        return False
    # 열린 원형 글자의 오른쪽 가로획 존재 여부 확인
    if letter == "G" and normalized[14:20, 18:31].mean() < 0.28:
        # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
        return False
    # 세로획과 아래 가로획으로 구성된 글자 조건 확인
    if letter == "L":
        # 비어 있어야 하는 오른쪽 윗부분의 과도한 획 제외
        if normalized[2:21, 16:30].mean() > 0.12:
            # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
            return False
        # 아래 가로획이 충분히 이어져 있는지 확인
        if normalized[28:32, 4:29].mean() < 0.6:
            # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
            return False

    # 글자 후보와 템플릿의 정규화된 형태 유사도를 계산
    def similarity(candidate: str) -> float:
        # 고정 템플릿 중 관측 글자와 이진 획 겹침이 가장 큰 값 반환
        return max(
            2 * np.logical_and(normalized, template).sum() / (normalized.sum() + template.sum())
            for template in templates(candidate)
        )

    # 목표 글자와의 형태 유사도 계산
    score = similarity(letter)
    # 원형 숫자와 유사 문자 등 혼동할 수 있는 대체 형태 선택
    alternatives = {"O": "0Q", "A": "4"}.get(letter, "")
    # 최소 유사도를 넘고 혼동 형태보다 더 가까운 글자만 허용
    return score >= 0.66 and all(score > similarity(alternative) for alternative in alternatives)

# 붙은 글자 분할과 득점 문구 형태 대조
def joinedWord(mask: np.ndarray, letters: str = "GOAL") -> bool:
    """붙은 굵은 글자의 제한된 세로 분할 시도

    화면 복사 자산이 아닌 비례 조판 범위의 분할
    분할된 각 글자의 연결 구조·형태 독립 충족 요구"""
    # 붙어 있는 글자 영역의 전체 너비 읽음
    width = mask.shape[1]
    # 좁은 마지막 글자를 고려한 상대 글자 너비 비율 구성
    weights = [0.72 if letter == "L" else 1.0 for letter in letters]
    # 예상 글자 너비 비율에서 분할 위치 계산
    divisions = [sum(weights[:index]) / sum(weights) for index in range(1, len(letters))]

    # 목표 단어에 맞는 글자 순서·간격 탐색
    def match(index: int, left: int, previous_height: int | None) -> bool:
        # 마지막 글자는 끝까지 쓰고 나머지는 예상 경계 주변만 탐색
        candidates = (
            [width]
            if index == len(letters) - 1
            else range(
                round(width * (divisions[index] - 0.07)),
                round(width * (divisions[index] + 0.07)) + 1,
            )
        )
        # 허용한 글자 오른쪽 경계 후보 순회
        for right in candidates:
            # 현재 글자에 해당할 수 있는 세로 영역 분리
            part = mask[:, left:right]
            # 분할 영역 안의 실제 글자 픽셀 탐색
            points = cv2.findNonZero(part)
            # 비교할 흰색 글자 성분 존재 여부 확인
            if points is None:
                # 글자 크기·간격·순서 조건에 맞지 않는 분할 제외
                continue
            # 분할된 글자 픽셀의 실제 너비와 높이 계산
            _, _, w, h = cv2.boundingRect(points)
            # 글자 높이와 가로세로 비율이 지원 범위 안인지 확인
            if not 16 <= h <= 31 or not 0.45 <= w / h <= 1.25:
                # 글자 크기·간격·순서 조건에 맞지 않는 분할 제외
                continue
            # 바로 앞 글자와 현재 글자의 높이가 비슷한지 확인
            if previous_height is not None and not 0.72 <= h / previous_height <= 1.4:
                # 글자 크기·간격·순서 조건에 맞지 않는 분할 제외
                continue
            # 현재 글자 모양과 이어지는 나머지 글자 순서가 모두 맞는지 확인
            if glyphMatch(part, letters[index]) and (
                index == len(letters) - 1 or match(index + 1, right, h)
            ):
                # 모든 필요한 글자의 모양과 배치가 맞음을 반환
                return True
        # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
        return False

    # 첫 글자부터 예상 단어 전체의 제한된 분할 탐색 시작
    return match(0, 0, None)

# 연결 성분의 글자 배치가 득점 표시 형태에 맞는지 확인
def componentWord(components: list[tuple[int, int, int, int, int]], labels: np.ndarray) -> bool:

    # 목표 단어에 맞는 글자 순서·간격 탐색
    def match(index: int, offset: int) -> bool:
        # 모든 실제 연결 성분을 검사했는지 확인
        if index == len(components):
            # 네 글자를 빠짐없이 소비했을 때만 단어 일치 반환
            return offset == 4
        # 현재 연결 성분의 위치·크기·표식 읽음
        x, y, width, height, label = components[index]
        # 다른 글자 성분을 섞지 않고 현재 연결 성분만 분리
        mask = np.where(labels[y:y + height, x:x + width] == label, 255, 0).astype(np.uint8)
        # 실제 연결 요소 경계 보존과 단어 전체 분할 금지
        # 인접 글자 조각 이동으로 잘못된 글자 생성 방지
        counts = [1] if width / height <= 1.25 else range(2, 5 - offset)
        # 한 연결 성분에 붙어 있을 수 있는 글자 수 탐색
        for count in counts:
            # 목표 네 글자를 넘는 분할 조합 제외
            if offset + count > 4:
                # 글자 크기·간격·순서 조건에 맞지 않는 분할 제외
                continue
            # 현재 연결 성분이 담당할 목표 문자 구간 선택
            letters = "GOAL"[offset:offset + count]
            # 단일 글자는 직접 비교하고 붙은 글자는 제한된 분할로 비교
            accepted = glyphMatch(mask, letters) if count == 1 else joinedWord(mask, letters)
            # 현재 성분과 뒤 성분의 문자 순서가 모두 맞는지 확인
            if accepted and match(index + 1, offset + count):
                # 모든 필요한 글자의 모양과 배치가 맞음을 반환
                return True
        # 목표 글자·단어의 형태 조건을 만족하지 않음을 반환
        return False

    # 첫 연결 성분과 첫 글자부터 단어 전체 대응 시작
    return match(0, 0)

# 화면에서 지속성 검사의 대상이 될 득점 표시 표시 상자를 검색
def goalBox(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    # 색상 채널과 최소 해상도가 방송 표시 탐색 조건에 맞는지 확인
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.shape[0] < 180:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 원본 방송 화면의 높이와 너비 읽음
    height, width = frame.shape[:2]
    # 지원하는 가로형 방송 화면 비율인지 확인
    if not 1.65 <= width / height <= 1.9:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 제한된 점수판 영역만 정규화하고 경기장·광고 탐색 제외
    crop = frame[
        round(height * 20 / 540) : round(height * 70 / 540),
        round(width * 28 / 960) : round(width * 264 / 960),
    ]
    # 고정 점수판 영역을 템플릿 기준 크기로 정규화
    image = cv2.resize(crop, (236, 50), interpolation=cv2.INTER_AREA)
    # 방송 그래픽의 색 띠와 흰 글자를 분리할 색상 공간 생성
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # 색조·채도·밝기 채널 분리
    hue, saturation, value = cv2.split(hsv)
    # 충분한 채도와 밝기를 가진 그래픽 색상 픽셀 선택
    colored = (saturation >= 95) & (value >= 45)
    # 지원 방송 표시의 빨간색 띠 후보 선택
    red = colored & ((hue <= 12) | (hue >= 145))
    # 지원 방송 표시의 파란색 띠 후보 선택
    blue = colored & (hue >= 95) & (hue <= 140)
    # 시계 영역의 어두운 남색 띠 후보 선택
    navy = blue & (value <= 160)
    # 위쪽 빨간 띠와 아래쪽 남색 시계 띠가 함께 있는지 확인
    if red[2:30].mean() < 0.05 or navy[32:47].mean() < 0.55:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 점수판 상단의 밝고 낮은 채도인 글자 픽셀 추출
    mask = cv2.inRange(hsv[:32], np.array([0, 0, 190]), np.array([179, 85, 255]))
    # 표시 경계의 얇은 잡음이 글자와 이어지지 않도록 제거
    mask[:2] = 0
    # 흰색 글자 후보의 연결 성분과 사각형 통계 계산
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    # 크기 조건을 만족하는 글자 연결 성분 목록 생성
    components = []
    # 배경을 제외한 연결 성분 순회
    for index in range(1, count):
        # 현재 연결 성분의 위치·크기·면적 읽음
        x, y, w, h, area = (int(value) for value in stats[index])
        # 잡음과 큰 도형을 제외할 글자 크기 조건 확인
        if 16 <= h <= 31 and w >= 7 and area >= 40:
            # 글자 크기 조건을 만족하는 실제 연결 성분 보존
            components.append((x, y, w, h, index))
    # 글자 연결 성분을 화면 왼쪽부터 순서대로 정렬
    components.sort()
    # 붙은 글자를 포함해 한 개부터 네 개의 성분인지 확인
    if not 1 <= len(components) <= 4:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 전체 목표 단어의 왼쪽 경계 읽음
    x = components[0][0]
    # 전체 글자 영역의 가장 위쪽 경계 계산
    y = min(item[1] for item in components)
    # 전체 글자 영역의 오른쪽 경계 계산
    right = max(item[0] + item[2] for item in components)
    # 전체 글자 영역의 아래쪽 경계 계산
    bottom = max(item[1] + item[3] for item in components)
    # 목표 단어 전체 너비가 지원 범위 안인지 확인
    if not 55 <= right - x <= 150:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 잘라낸 영역 좌표를 표준 방송 화면 기준으로 변환
    box = x + 28, y + 20, right - x, bottom - y
    # 네 글자가 일부 붙은 연결 성분 구조인지 확인
    if len(components) != 4:
        # 붙은 글자도 단어 전체를 만족할 때만 표시 상자 반환
        return box if componentWord(components, labels) else None
    # 글자별 높이 비교 자료 생성
    heights = [item[3] for item in components]
    # 글자별 세로 중심 정렬 비교 자료 생성
    centers = [item[1] + item[3] / 2 for item in components]
    # 글자 크기가 다르거나 한 줄로 정렬되지 않았는지 확인
    if max(heights) / min(heights) > 1.4 or max(centers) - min(centers) > 6:
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None
    # 서로 인접한 글자 성분의 간격 확인
    for left, right in zip(components, components[1:]):
        # 이웃 글자 사각형 사이의 가로 간격 계산
        gap = right[0] - left[0] - left[2]
        # 글자 겹침 또는 간격이 지원하는 단어 배치인지 확인
        if not -3 <= gap <= max(heights) * 0.65:
            # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
            return None
    # 왼쪽부터 목표 단어의 각 문자 모양 대조
    for component, letter in zip(components, "GOAL"):
        # 현재 글자의 실제 연결 성분 경계 읽음
        x, y, w, h, index = component
        # 해당 글자 성분의 픽셀만 잘라 비교 마스크 생성
        glyph = np.where(labels[y:y + h, x:x + w] == index, 255, 0).astype(np.uint8)
        # 현재 글자가 목표 위치의 고정 문자 형태와 맞는지 확인
        if not glyphMatch(glyph, letter):
            # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
            return None
    # 지정한 방송 표시 형태가 확인된 화면 상자 반환
    return box

# 현재 프레임에 지원하는 득점 표시 방송 표시가 있는지 확인
def graphic(frame: np.ndarray) -> bool:
    """득점 사건이 아닌 단일 프레임의 지원 득점 표시 판독 가능 여부"""
    # 득점 사실이 아닌 지원 방송 표시의 존재 여부 반환
    return goalBox(frame) is not None


class BroadcastCueRecognizer:
    """안정된 글자 관측 확인과 2초 부재 전까지 단일 출력

    미확인 관측의 샷 전환·1초 200밀리초 초과 공백 연결 금지
    이미 출력한 표시의 샷 전환 뒤 중복 출력 방지
    전체 표시·경기 사건 길이가 아닌 실제 확인 관측 구간만 보고"""

    # 초기 상태·입력 계약 구성
    def __init__(self):
        # 원본 시간 순서 검사 기준 초기화
        self._last_ms: int | None = None
        # 미확인 표시 연결에 사용할 화면 연속 구간 초기화
        self._continuity_id: int | None = None
        # 현재 표시가 처음 확인된 원본 시각 초기화
        self._start_ms: int | None = None
        # 동일 표시 위치를 확인할 기준 상자 초기화
        self._box: tuple[int, int, int, int] | None = None
        # 표시가 실제 확인된 원본 프레임 시각 목록 생성
        self._evidence: list[int] = []
        # 충분한 부재 뒤 새 표시를 출력할 수 있도록 상태 해제
        self._emitted = False
        # 표시가 사라진 기간의 시작 시각 초기화
        self._absent_since_ms: int | None = None

    # 확정되지 않은 방송 표시의 시간적 지지 상태를 초기화
    def pendingReset(self):
        # 지속성 미확인 표시의 시작 시각 해제
        self._start_ms = None
        # 지속성 미확인 표시의 기준 위치 해제
        self._box = None
        # 끊어진 미확인 표시의 근거 시각 목록 비움
        self._evidence = []

    # 득점 표시 위치·지속 누적으로 반복 출력 방지
    def update(self, frame: np.ndarray, timestamp_ms: int, continuity_id: int) -> dict | None:
        # 음수·중복·역행 시각의 표본인지 확인
        if timestamp_ms < 0 or (self._last_ms is not None and timestamp_ms <= self._last_ms):
            # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
            return None
        # 긴 표본 공백 또는 화면 연속 구간 변경 여부 확인
        if self._last_ms is not None and (
            timestamp_ms - self._last_ms > 1200 or continuity_id != self._continuity_id
        ):
            # 미확인 표시를 끊어진 구간 너머로 이어붙이지 않도록 초기화
            self.pendingReset()
        # 최근 처리한 표본의 원본 시각 갱신
        self._last_ms = timestamp_ms
        # 현재 화면 연속 구간 식별자 보존
        self._continuity_id = continuity_id
        # 현재 프레임에서 지원 방송 표시 형태 탐색
        box = goalBox(frame)
        # 현재 표본에서 목표 표시를 확인하지 못했는지 확인
        if box is None:
            # 미확인 표시를 끊어진 구간 너머로 이어붙이지 않도록 초기화
            self.pendingReset()
            # 표시 부재 구간의 첫 표본인지 확인
            if self._absent_since_ms is None:
                # 표시가 확인되지 않기 시작한 시각 보존
                self._absent_since_ms = timestamp_ms
            # 이전 표시와 별개로 취급할 만큼 부재가 지속되었는지 확인
            elif timestamp_ms - self._absent_since_ms >= 2000:
                # 충분한 부재 뒤 새 표시를 출력할 수 있도록 상태 해제
                self._emitted = False
            # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
            return None
        # 표시가 다시 확인되어 부재 시간 이력 해제
        self._absent_since_ms = None
        # 현재 표시 구간을 이미 출력했는지 확인
        if self._emitted:
            # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
            return None
        # 현재 표시와 비교할 이전 상자 위치 존재 여부 확인
        if self._box is not None:
            # 직전 표시 상자의 기준 위치와 크기 읽음
            before_x, before_y, before_w, before_h = self._box
            # 현재 표시 상자의 위치와 크기 읽음
            x, y, w, h = box
            # 표시 중심 위치와 너비가 이전 관측에 비해 크게 변했는지 확인
            if (
                abs(x + w / 2 - before_x - before_w / 2) > 12
                or abs(y + h / 2 - before_y - before_h / 2) > 6
                or not 0.75 <= w / before_w <= 1.33
            ):
                # 미확인 표시를 끊어진 구간 너머로 이어붙이지 않도록 초기화
                self.pendingReset()
        # 현재 지속 구간의 첫 표시 관측인지 확인
        if self._start_ms is None:
            # 표시 지속 구간의 시작 시각 보존
            self._start_ms = timestamp_ms
            # 표시 위치 일관성을 검사할 기준 상자 보존
            self._box = box
        # 이번 표시를 실제 확인한 프레임 시각 추가
        self._evidence.append(timestamp_ms)
        # 최소 지속 시간과 두 개 이상의 관측 프레임을 충족하는지 확인
        if timestamp_ms - self._start_ms >= 300 and len(self._evidence) >= 2:
            # 같은 표시 구간을 다시 출력하지 않도록 기록
            self._emitted = True
            # 득점 인정과 분리된 방송 그래픽 관측과 근거 시각 반환
            return {
                "kind": "GOAL_GRAPHIC",
                "method": "broadcast-goal-glyphs-v1",
                "startMs": self._start_ms,
                "endMs": timestamp_ms,
                "evidenceTimestampsMs": self._evidence.copy(),
            }
        # 지원하는 방송 표시를 확인할 근거가 없어 관측 보류
        return None

    # 남은 연속 관측을 마감하고 최종 결과를 반환
    def finish(self) -> dict | None:
        """확인된 구간은 이미 반환됐으므로 지연 출력 없음"""
        # 이미 확인된 구간은 즉시 반환했으므로 추가 지연 결과 없음
        return None
