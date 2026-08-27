from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    source: Path
    duration_ms: int
    width: int
    height: int
    fps: float
    frame_count: int
    codec: str


@dataclass(frozen=True, slots=True)
class Shot:
    index: int
    start_ms: int
    end_ms: int
    playback_speed: str = "UNKNOWN"
    is_replay: bool = False
    camera_angle: str | None = None


@dataclass(frozen=True, slots=True)
class Candidate:
    index: int
    category: str
    start_ms: int
    end_ms: int
    anchor_ms: int
    confidence: float
    camera_sufficiency: str
    reasons: tuple[str, ...]
    shot_indices: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Evidence:
    candidate_index: int
    kind: str
    path: Path
    timestamp_ms: int
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class PipelineResult:
    schema_version: int
    pipeline_version: str
    video: VideoMetadata
    shots: tuple[Shot, ...]
    candidates: tuple[Candidate, ...]
    evidence: tuple[Evidence, ...]
    report_path: Path
