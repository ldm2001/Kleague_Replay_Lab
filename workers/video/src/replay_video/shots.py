from __future__ import annotations

from pathlib import Path

from .models import Shot, VideoMetadata
from .signals import signals


def shots(
    source: Path | str,
    metadata: VideoMetadata,
    *,
    cut_threshold: float = 0.45,
    sample_fps: float = 10.0,
) -> tuple[Shot, ...]:
    boundaries = [0]
    frame_ms = max(1, round(1000 / metadata.fps))
    for signal in signals(source, metadata, sample_fps):
        if signal.score >= cut_threshold and signal.timestamp_ms - boundaries[-1] >= 300:
            boundaries.append(signal.timestamp_ms)

    result: list[Shot] = []
    for index, start_ms in enumerate(boundaries):
        next_start = boundaries[index + 1] if index + 1 < len(boundaries) else metadata.duration_ms
        end_ms = metadata.duration_ms if index + 1 == len(boundaries) else max(start_ms + frame_ms, next_start - frame_ms)
        result.append(Shot(index=index, start_ms=start_ms, end_ms=end_ms))
    return tuple(result)
