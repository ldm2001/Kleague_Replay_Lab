# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 색상과 선분 및 미리보기를 다룰 영상 처리 도구 읽음
import cv2
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np


# 화면 외형 연속 구간의 필드와 동작을 묶을 자료형 선언
class AppearanceContinuity:
    """보수적 표본 프레임 외형 맥락이며 검증된 방송 샷 아님"""

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 이전을 아직 없는 상태로 초기화
        self._previous = None
        # 배열 크기를 아직 없는 상태로 초기화
        self._shape = None
        # 경계 수량을 0 값으로 설정
        self.boundary_count = 0
        # 출처 정보를 다음 항목으로 구성
        self.provenance = {
            # 방법 필드 기록
            "method": "sampled-appearance-delta-v1",
            # 축소 영상 너비 필드 기록
            "thumbnailWidth": 96,
            # 축소 영상 높이 필드 기록
            "thumbnailHeight": 54,
            # 평균 삼원색 영상 차이 임계값 필드 기록
            "meanRgbDifferenceThreshold": 0.20,
            # 해상도 변화 초기화 여부 필드 기록
            "resolutionChangeResets": True,
            # 처리 성공을 전체 파울 판정 성공으로 오인하지 않도록 작업 범위 기록
            "scope": "SAMPLED_APPEARANCE_ONLY",
            # 해석 한계 필드 기록
            "limitations": [
                "May miss cuts or reset on large motion; does not establish actor identity or live/replay status."
            ],
        }

    # 프레임의 색상 변화로 추적을 이어갈 수 없는 화면 전환을 구분
    def update(self, rgb: np.ndarray) -> int:
        # 프레임의 자료 형식과 허용 조건 확인
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.dtype != np.uint8
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or min(rgb.shape[:2]) <= 0
        ):
            # 프레임 유효하지 않음 오류 알림
            raise ValueError("FRAME_INVALID")
        # 영상을 고정된 작은 크기와 영부터 일 사이 실수 배열로 바꿔 표본 간 색상 비교 준비
        current = cv2.resize(rgb, (96, 54), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
        # 이전 관측값이 있는지 확인
        if self._previous is not None:
            # 축소 영상의 평균 색상 차이를 측정하되 실제 방송 컷이나 접촉으로 해석하지 않음
            difference = float(np.mean(np.abs(current - self._previous)))
            # 해상도 변화나 큰 외형 차이가 있으면 보수적으로 연속 구간 분리
            if rgb.shape != self._shape or difference > .20:
                # 경계 수량에 1을 더해 누적
                self.boundary_count += 1
        # 다음 표본과 비교할 현재 축소 영상 보존
        self._previous = current
        # 해상도 변화를 구분하기 위해 원본 배열 크기 보존
        self._shape = rgb.shape
        # 경계 수량 반환
        return self.boundary_count
