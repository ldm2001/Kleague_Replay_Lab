from __future__ import annotations

from pathlib import Path

from .models import Candidate, Shot, VideoMetadata
from .signals import signals


def _shot_for(timestamp_ms: int, items: tuple[Shot, ...]) -> Shot | None:
    return next((item for item in items if item.start_ms <= timestamp_ms <= item.end_ms), None)


def candidates(
    source: Path | str,
    metadata: VideoMetadata,
    shot_list: tuple[Shot, ...],
    *,
    motion_threshold: float = 0.18,
    min_gap_ms: int = 2500,
) -> tuple[Candidate, ...]:
    peaks: list[tuple[int, float]] = []
    for signal in signals(source, metadata):
        shot = _shot_for(signal.timestamp_ms, shot_list)
        if shot is None or (shot.start_ms > 0 and abs(signal.timestamp_ms - shot.start_ms) < 250):
            continue
        if signal.score < motion_threshold:
            continue
        if peaks and signal.timestamp_ms - peaks[-1][0] < min_gap_ms:
            if signal.score > peaks[-1][1]:
                peaks[-1] = (signal.timestamp_ms, signal.score)
        else:
            peaks.append((signal.timestamp_ms, signal.score))

    result: list[Candidate] = []
    for index, (anchor_ms, score) in enumerate(peaks, start=1):
        start_ms = max(0, anchor_ms - 1200)
        end_ms = min(metadata.duration_ms, anchor_ms + 1200)
        related = tuple(item.index for item in shot_list if item.end_ms >= start_ms and item.start_ms <= end_ms)
        confidence = min(0.95, max(0.15, 0.15 + ((score - motion_threshold) / max(1.0 - motion_threshold, 0.01)) * 0.8))
        result.append(
            Candidate(
                index=index,
                category="OTHER",
                start_ms=start_ms,
                end_ms=end_ms,
                anchor_ms=anchor_ms,
                confidence=round(confidence, 4),
                camera_sufficiency="MEDIUM",
                reasons=("motion_spike", "baseline_detector"),
                shot_indices=related,
            )
        )
    return tuple(result)
