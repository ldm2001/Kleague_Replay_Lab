from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


LOCAL_OBSERVER_PIPELINE_VERSION = "video-local-observers-v1"


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    # 영상 메타데이터
    source: Path
    duration_ms: int
    width: int
    height: int
    fps: float
    frame_count: int
    codec: str


@dataclass(frozen=True, slots=True)
class Shot:
    # 영상 샷
    index: int
    start_ms: int
    end_ms: int
    playback_speed: str = "UNKNOWN"
    is_replay: bool = False
    camera_angle: str | None = None


@dataclass(frozen=True, slots=True)
class Candidate:
    # 판정 후보
    index: int
    category: str
    start_ms: int
    end_ms: int
    anchor_ms: int
    confidence: float
    camera_sufficiency: str
    reasons: tuple[str, ...]
    shot_indices: tuple[int, ...]
    # 공 후보 경로의 구간별 측정 요약이며 신체 접촉 사실은 포함하지 않는다
    tracking: dict[str, object] | None = None
    # 영상에서 관찰한 재개 상황과 근거 시각을 서버 rules 필터에 전달한다
    scene_event: dict[str, object] | None = None
    # 방송 그래픽의 관찰 단서이며 경기 사건이나 규정 판정을 확정하지 않는다
    broadcast_cue: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class Evidence:
    # 증거 자료
    candidate_index: int
    kind: str
    path: Path
    timestamp_ms: int
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class PerceptionOutput:
    candidates: tuple[Candidate, ...]
    perception: dict[str, object]


@dataclass(frozen=True, slots=True)
class PipelineResult:
    # 파이프라인 결과
    schema_version: int
    pipeline_version: str
    video: VideoMetadata
    shots: tuple[Shot, ...]
    candidates: tuple[Candidate, ...]
    evidence: tuple[Evidence, ...]
    report_path: Path
