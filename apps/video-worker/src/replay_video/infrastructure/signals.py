from __future__ import annotations
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import cv2
import numpy as np
from ..domain.models import VideoMetadata


@dataclass(frozen=True, slots=True)
class Signal:
    # 영상 변화 신호
    frame_index: int
    # 원본 프레임 번호에서 계산한 상대 시각 보존
    timestamp_ms: int
    # 픽셀·색상 변화 크기이며 접촉이나 파울 확률 아님
    score: float

# 색상 히스토그램 계산
def histogram(frame: np.ndarray) -> np.ndarray:
    # 색상 공간 변환
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # 색상 히스토그램 생성
    histogram = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
    # 히스토그램 정규화
    return cv2.normalize(histogram, histogram).flatten()

# 영상 변화 수집
@lru_cache(maxsize=8)
def signals(
    source: Path | str, metadata: VideoMetadata, sample_fps: float = 2.0
) -> tuple[Signal, ...]:
    # 영상 캡처 열기
    capture = cv2.VideoCapture(str(source))
    # 영상 디코더가 원본을 읽을 수 있는지 확인
    if not capture.isOpened():
        # 원본을 열지 못한 경우 변화 신호 생성 중단
        raise RuntimeError("video-open-failed")

    # 샘플 간격 계산
    stride = max(1, round(metadata.fps / max(sample_fps, 1.0)))
    # 신호 결과 초기화
    result: list[Signal] = []
    # 이전 히스토그램 초기화
    previous_histogram: np.ndarray | None = None
    # 이전 프레임 초기화
    previous_frame: np.ndarray | None = None
    # 프레임 인덱스 초기화
    frame_index = 0
    # 읽기 성공 여부와 무관하게 디코더를 해제할 구간 시작
    try:
        # 원본 프레임을 끝까지 순차적으로 탐색
        while True:
            # 다음 프레임 확보
            if not capture.grab():
                # 더 이상 원본 프레임을 확보하거나 복원할 수 없어 읽기 종료
                break
            # 현재 프레임이 지정한 분석 표본 간격 밖인지 확인
            if frame_index % stride != 0:
                # 샘플 외 프레임 건너뛰기
                frame_index += 1
                # 분석 간격 밖 프레임은 복원 연산 없이 다음 프레임으로 이동
                continue

            # 샘플 프레임 변환
            ok, frame = capture.retrieve()
            # 확보한 표본 프레임의 픽셀 복원 성공 여부 확인
            if not ok:
                # 더 이상 원본 프레임을 확보하거나 복원할 수 없어 읽기 종료
                break

            # 분석용 크기 축소
            small = cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA)
            # 현재 히스토그램 계산
            current = histogram(small)
            # 차이를 계산할 직전 표본이 존재하는지 확인
            if previous_histogram is not None and previous_frame is not None:
                # 픽셀 움직임 계산
                motion = float(cv2.absdiff(previous_frame, small).mean() / 255.0)
                # 히스토그램 차이 계산
                histogram_distance = float(
                    cv2.compareHist(previous_histogram, current, cv2.HISTCMP_BHATTACHARYYA)
                )
                # 변화 신호 기록
                result.append(
                    Signal(
                        frame_index,
                        round(frame_index * 1000 / metadata.fps),
                        max(motion, histogram_distance),
                    )
                )
            # 이전 신호 갱신
            previous_histogram = current
            # 다음 표본의 픽셀 변화 비교 기준 갱신
            previous_frame = small
            # 프레임 인덱스 증가
            frame_index += 1
    # 원본 읽기 종료 또는 실패 시 자원 정리
    finally:
        # 영상 디코더와 원본 파일 자원 해제
        capture.release()
    # 신호 결과 반환
    return tuple(result)
