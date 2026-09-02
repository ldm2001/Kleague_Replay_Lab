from __future__ import annotations

from pathlib import Path

from ..domain.models import Shot, VideoMetadata
from .signals import signals


# 샷 경계 생성
def shots(
    source: Path | str,
    metadata: VideoMetadata,
    *,
    cut_threshold: float = 0.45,
    sample_fps: float = 2.0,
) -> tuple[Shot, ...]:
    # 첫 샷 시작점 초기화
    boundaries = [0]
    # 프레임 시간 간격 계산
    frame_ms = max(1, round(1000 / metadata.fps))
    # 변화 신호 순회
    for signal in signals(source, metadata, sample_fps):
        # 샷 경계 조건 확인
        if signal.score >= cut_threshold and signal.timestamp_ms - boundaries[-1] >= 300:
            # 경계 시각 추가
            boundaries.append(signal.timestamp_ms)

    # 샷 결과 초기화
    result: list[Shot] = []
    # 경계별 샷 생성
    for index, start_ms in enumerate(boundaries):
        # 다음 경계 시각 선택
        next_start = boundaries[index + 1] if index + 1 < len(boundaries) else metadata.duration_ms
        # 종료 시각 계산
        end_ms = metadata.duration_ms if index + 1 == len(boundaries) else max(start_ms + frame_ms, next_start - frame_ms)
        # 샷 결과 추가
        result.append(Shot(index=index, start_ms=start_ms, end_ms=end_ms))
    # 샷 결과 반환
    return tuple(result)
